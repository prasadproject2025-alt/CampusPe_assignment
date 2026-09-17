import {automationAnswersSchema} from '../dist/automation/answerSchema.js'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {resolve,extname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {launchHeadlessAutomationBrowser,runWithBrowserPermit} from '../dist/automation/browserLauncher.js'
const root=fileURLToPath(new URL('../../frontend/dist/',import.meta.url))
for(const autoSubmit of [false,true]) {
 const worker=await runWithBrowserPermit('test',launchHeadlessAutomationBrowser)
 const fields=[{id:'sanctions',text:'Sanctions declarations',fieldType:'select',inputType:'checkbox-group',options:['Option A','Option B','None'],required:true,value:'',status:'unresolved'}, {id:'ats:application:radio:are_you_a_current_or_previous_employee_of_dun_bradstreet:current_contractor|current_employee_or_intern|former_contractor|former_employee_or_intern|no_previous_work_experience_with_the_company',text:'Employer question',fieldType:'select',inputType:'radio',options:['Yes','No'],required:true,value:'',status:'unresolved'}, {id:'country',text:'Phone country code',fieldType:'select',inputType:'country-code',required:true,value:'',status:'unresolved'}]
 let run={id:'fixture',jobUrl:'https://job-boards.greenhouse.io/fixture/jobs/123',jobBoard:'greenhouse',strategy:'CUSTOM_FORM',status:'PAUSED_NEEDS_INPUT',currentStep:'WAITING_FOR_USER',autoSubmit,testMode:false,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),events:[],job:{jobTitle:'Fixture role',company:'Fixture'},pause:{reason:'Complete required answers'},application:{provider:'greenhouse',strategy:'CUSTOM_FORM',fields,sections:[],schemaComplete:true,displayMode:'native_form'}}
 let saves=0,submits=0,assistedStarts=0
 const errors=[]
 try {
  const page=await worker.context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept())
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.hostname!=='jobcopilot.test')return route.abort()
   if(url.pathname.startsWith('/api/')) {
    let data={run}
    if(url.pathname==='/api/auth/me')data={user:{name:'Fixture',email:'fixture@example.test'}}
    else if(url.pathname==='/api/jobs/recommended')data={jobs:[],sources:[],pagination:{total:0,hasMore:false}}
    else if(url.pathname==='/api/jobs/saved')data={jobs:[]}
    else if(url.pathname==='/api/automation/runs')data={runs:[run]}
    else if(url.pathname==='/api/automation/boards')data={boards:['greenhouse','lever','workable']}
    else if(url.pathname==='/api/locations/countries')data={options:[{code:'IN',name:'India',dialCode:'+91'},{code:'US',name:'United States',dialCode:'+1'}]}
    else if(url.pathname==='/api/profile')data={profile:{resume:null}}
    else if(url.pathname.endsWith('/answers')) {
     saves++;await new Promise(r=>setTimeout(r,150))
     for(const update of automationAnswersSchema.parse(route.request().postDataJSON()).fields)Object.assign(fields.find(f=>f.id===update.id),{value:update.value,status:'manual'})
     run={...run,updatedAt:new Date().toISOString()};data={run};saves--
    }else if(url.pathname.endsWith('/assisted/submit')) {
     assert.equal(assistedStarts,1);submits++
     run={...run,status:'SUBMITTED',assistedSession:{...run.assistedSession,status:'SUBMITTED'},updatedAt:new Date().toISOString()};data={run}
    }else if(url.pathname.endsWith('/submit')) {
     submits++;throw new Error('Assisted-only UI must never call Submit')
    }else if(url.pathname.endsWith('/resume')||url.pathname.endsWith('/assisted')) {
     assert.equal(saves,0);assert.deepEqual(fields.map(f=>f.value),['Option A|Option B','No','IN'])
     if(url.pathname.endsWith('/assisted')) {assistedStarts++;run={...run,assistedSession:{id:'session',runId:run.id,status:'USER_REVIEWING',reason:'Review the live form'}}}
     run={...run,status:'READY_FOR_REVIEW',currentStep:'AWAITING_FINAL_REVIEW',pause:null,updatedAt:new Date().toISOString()};data={run}
    }
    return route.fulfill({contentType:'application/json',body:JSON.stringify({data})})
   }
   const path=resolve(root,url.pathname==='/'?'index.html':url.pathname.slice(1));if(!path.startsWith(root))return route.abort()
   return route.fulfill({contentType:extname(path)==='.js'?'text/javascript':extname(path)==='.css'?'text/css':'text/html',body:await readFile(path)})
  })
  await page.goto('https://jobcopilot.test/')
  await page.getByRole('button',{name:'Applications 1',exact:true}).click()
  await page.getByRole('button',{name:'View application for Fixture role'}).click()
  await page.getByRole('checkbox',{name:'Option A',exact:true}).check()
  await page.getByRole('checkbox',{name:'Option B',exact:true}).check()
  assert.equal(await page.getByRole('checkbox',{name:'Option A',exact:true}).isChecked(),true)
  await page.getByRole('combobox',{name:'Employer question',exact:true}).selectOption('No')
  await page.getByRole('combobox',{name:'Phone country code',exact:true}).selectOption('IN')
  assert.deepEqual(await page.getByRole('combobox',{name:'Phone country code',exact:true}).locator('option').allTextContents(),['Select phone country','India (+91)','United States (+1)'])
  await page.getByRole('button',{name:'Continue',exact:true}).click()
  await page.getByRole('button',{name:'Continue in assisted browser',exact:true}).click()
  await page.getByRole('button',{name:'Submit application',exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Retry submit',exact:true}).count(),0)
  assert.equal(assistedStarts,1);assert.equal(submits,0);assert.deepEqual(errors,[])
  await page.getByRole('button',{name:'Submit application',exact:true}).click()
  await page.getByText('Submitted successfully',{exact:true}).waitFor()
  assert.equal(submits,1)
  console.log(`PASS saved ${autoSubmit?'auto-submit':'approval'} run: no automatic Submit; explicit side Submit uses the assisted session`)

 }finally{await worker.browser.close()}
}
