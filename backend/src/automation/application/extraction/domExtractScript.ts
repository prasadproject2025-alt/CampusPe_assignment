/** Browser-evaluated as a string so bundlers cannot inject `__name` into the page. */
export const DOM_EXTRACT_SCRIPT = `(() => {
  function pickRoot() {
    var nodes = [];
    var ashby = document.querySelector('.ashby-application-form-container, .ashby-application-form, #form[role="tabpanel"]');
    if (ashby) nodes.push(ashby);
    var tagged = document.querySelector('#application-form, form[id*="application" i]');
    if (tagged) nodes.push(tagged);
    var pathRoot = document.querySelector('[data-field-path]') && document.querySelector('[data-field-path]').closest('form, main, [class*="application-form"], body');
    if (pathRoot) nodes.push(pathRoot);
    var forms = document.querySelectorAll('form');
    var f;
    for (f = 0; f < forms.length; f++) nodes.push(forms[f]);
    var best = document.body;
    var bestCount = -1;
    var i;
    for (i = 0; i < nodes.length; i++) {
      var count = nodes[i].querySelectorAll('input:not([type="hidden"]):not([type="search"]), textarea, select, [data-field-path], .ashby-application-form-field-entry').length;
      if (count > bestCount) { best = nodes[i]; bestCount = count; }
    }
    return best;
  }
  var form = pickRoot();
  if (!form) return [];
  function clean(value) {
    return String(value || '').replace(/\\s+/g, ' ').replace(/^\\*+/, '').replace(/\\*+$/, '').replace(/[✱*]+$/g, '').replace(/\\bchoose file\\b/ig, '').trim();
  }
  function optionLike(value) {
    var text = clean(value);
    if (!text) return true;
    return /^(yes|no|true|false|n\\/a|na|none|other|i agree|agree|disagree|prefer not to say|male|female|non-binary|he\\/him|she\\/her|they\\/them|he\\/him\\/his|she\\/her\\/hers|they\\/them\\/theirs|asian|white|black|hispanic|latino|decline to self-identify)$/i.test(text);
  }
  function tracking(name, id) {
    var key = ((name || '') + ' ' + (id || '')).toLowerCase();
    return /utm_|gclid|fbclid|recaptcha|csrf|authenticity_token|h-captcha|cf-turnstile|^nickname_/.test(key);
  }
  function generatedName(name) {
    return /^input_ca_\\d+_input$/i.test(name || '') || /^input_[a-z0-9]+_input$/i.test(name || '');
  }
  function bloated(text) {
    var value = clean(text);
    if (value.length > 80) return true;
    return /united states.*united kingdom|afghanistan.*albania|\\+\\d{1,3}.*\\+\\d{1,3}.*\\+\\d{1,3}/i.test(value);
  }
  function headingFrom(node) {
    if (!node) return '';
    var labelledBy = node.getAttribute('aria-labelledby') || '';
    if (labelledBy) {
      var parts = labelledBy.split(/\\s+/).map(function (id) {
        var el = document.getElementById(id);
        return el ? clean(el.textContent) : '';
      }).filter(function (text) { return text && !optionLike(text); });
      if (parts.length) return parts[0];
    }
    var aria = clean(node.getAttribute('aria-label') || '');
    if (aria && !optionLike(aria)) return aria;
    var legend = node.querySelector('legend');
    if (legend && !legend.querySelector('input, textarea, select')) return clean(legend.textContent);
    var labelNode = node.querySelector('.application-label .text, .application-label, .ashby-application-form-question-title');
    if (labelNode && !labelNode.querySelector('input, textarea, select')) return clean(labelNode.textContent);
    return '';
  }
  function stripOptionSuffix(text, options) {
    var stripped = clean(text);
    var qMark = stripped.indexOf('?');
    if (qMark >= 0 && optionLike(stripped.slice(qMark + 1))) stripped = clean(stripped.slice(0, qMark + 1));
    var oi2;
    for (oi2 = 0; oi2 < (options || []).length; oi2++) {
      stripped = stripped.replace(new RegExp('\\s+' + options[oi2].replace(/[.*+?^$()|[\\]\\\\]/g, '\\\\$&') + '\\s*$', 'i'), '');
    }
    return clean(stripped);
  }
  function optionText(control) {
    var byFor = control.id ? (form.querySelector('label[for="' + CSS.escape(control.id) + '"]') || {}).textContent : '';
    var wrap = control.closest('label');
    return clean(byFor || (wrap && wrap.textContent) || control.getAttribute('aria-label') || control.value);
  }
  function questionFor(control, options) {
    var labelled = (control.getAttribute('aria-labelledby') || '').split(/\\s+/).map(function (id) {
      var node = document.getElementById(id);
      return node ? clean(node.textContent) : '';
    }).filter(function (text) { return text && !optionLike(text) && !bloated(text); })[0] || '';
    var explicit = control.id ? form.querySelector('label[for="' + CSS.escape(control.id) + '"]') : null;
    var explicitText = explicit && !explicit.querySelector('input, textarea, select') ? clean(explicit.textContent) : '';
    var fieldset = control.closest('fieldset');
    var legend = fieldset && fieldset.querySelector('legend') ? clean(fieldset.querySelector('legend').textContent) : '';
    var group = control.closest('[role="radiogroup"], [role="group"], fieldset, .application-question, .ashby-application-form-field-entry, [data-ui="question"], [data-role="question"]');
    var heading = headingFrom(group);
    var dataUi = (control.getAttribute('data-ui') || '').replace(/[_-]+/g, ' ');
    var fromData = dataUi && !/^input /i.test(dataUi) && !optionLike(dataUi) ? dataUi.replace(/\\b\\w/g, function (c) { return c.toUpperCase(); }) : '';
    var wrapping = control.closest('label');
    var wrappingText = wrapping ? clean(wrapping.textContent) : '';
    var candidates = [heading, legend, labelled, explicitText, fromData, control.getAttribute('aria-label'), control.getAttribute('placeholder'), wrappingText];
    var i;
    for (i = 0; i < candidates.length; i++) {
      var text = stripOptionSuffix(candidates[i], options);
      if (!text || optionLike(text) || bloated(text)) continue;
      if (options.indexOf(text) !== -1 && text.length < 28) continue;
      return text;
    }
    return '';
  }
    function sectionFor(control) {
    var heading = control.closest('section, [class*="section"], [data-ui="section"]');
    if (heading) {
      var title = heading.querySelector('h2, h3, legend, [class*="section-title"]');
      if (title) return clean(title.textContent);
    }
    return '';
  }
  function kindOf(control, groupedType) {
    if (control.type === 'file') return 'file';
    if (groupedType === 'radio' || (control.getAttribute('role') || '') === 'radio') return 'radio';
    if (groupedType === 'checkbox' || (control.getAttribute('role') || '') === 'checkbox') return 'checkbox';
    if (control.tagName === 'SELECT') return 'select';
    if (control.tagName === 'TEXTAREA') return 'textarea';
    if (control.type === 'email') return 'email';
    if (control.type === 'tel') return 'phone';
    if (control.type === 'url') return 'url';
    if (control.type === 'date') return 'date';
    if ((control.getAttribute('role') || '') === 'combobox') return 'select';
    return control.type === 'number' ? 'unknown' : 'text';
  }
  var seen = {};
  var results = [];
  var nodes = form.querySelectorAll('input, textarea, select, [role="radio"], [role="checkbox"], [role="combobox"], [role="listbox"]');
  var n;
  for (n = 0; n < nodes.length; n++) {
    var control = nodes[n];
    if (control.type === 'hidden' || control.type === 'submit' || control.type === 'button' || control.type === 'image' || control.type === 'search') continue;
    if (control.tagName === 'BUTTON' && (control.getAttribute('role') || '') !== 'combobox') continue;
    if (control.closest && control.closest('.ashby-application-form-input-yesno, [class*="application-form-input-yesno"]')) continue;
    if (control.getAttribute('aria-hidden') === 'true' && control.type !== 'radio' && control.type !== 'checkbox' && control.type !== 'password') continue;
    var role = (control.getAttribute('role') || '').toLowerCase();
    if (role === 'option' || role === 'none') continue;
    if ((role === 'radio' || role === 'checkbox') && control.querySelector && control.querySelector('input[type="radio"], input[type="checkbox"]')) continue;
    var inputType = control.type || '';
    if (role === 'radio') inputType = 'radio';
    if (role === 'checkbox') inputType = 'checkbox';
    if (tracking(control.name, control.id)) continue;
    if (/(?:^|\\s)iti__(?:search|selected|flag|country|dial)/i.test(control.className || '')) continue;
    if ((control.id || '').indexOf('iti-') === 0 && inputType !== 'tel') continue;
    if (control.closest && control.closest('.iti, .intl-tel-input')) {
      if (inputType !== 'tel' && (control.className || '').indexOf('iti__tel-input') === -1) continue;
    }
    var visNode = control;
    var displayed = true;
    while (visNode && visNode.nodeType === 1) {
      var visStyle = window.getComputedStyle(visNode);
      if (visStyle.display === 'none' || visStyle.visibility === 'hidden') { displayed = false; break; }
      if (visNode === form) break;
      visNode = visNode.parentElement;
    }
    if (!displayed) continue;
    var groupRoot = control.closest('[role="radiogroup"], [role="group"], fieldset, .application-question, .ashby-application-form-field-entry, [data-ui="question"], [data-role="question"]');
    var groupHeading = headingFrom(groupRoot);
    var groupKey = '';
    if (inputType === 'radio' || inputType === 'checkbox') {
      groupKey = groupHeading ? (inputType + ':g:' + groupHeading) : (control.name ? inputType + ':' + control.name : '');
    }
    var dedupeKey = groupKey || control.name || control.id || control.getAttribute('data-ui') || String(n);
    if (seen[dedupeKey]) continue;
    seen[dedupeKey] = true;
    var grouped = [];
    if (groupKey && groupRoot) {
      var radios = groupRoot.querySelectorAll('input[type="' + inputType + '"], [role="' + inputType + '"]');
      var r;
      for (r = 0; r < radios.length; r++) grouped.push(radios[r]);
    } else if (groupKey && control.name) {
      var named = form.querySelectorAll('input[type="' + inputType + '"][name="' + CSS.escape(control.name) + '"], [role="' + inputType + '"][name="' + CSS.escape(control.name) + '"]');
      var g;
      for (g = 0; g < named.length; g++) grouped.push(named[g]);
    }
    var options = [];
    var oi;
    for (oi = 0; oi < grouped.length; oi++) {
      var ot = optionText(grouped[oi]);
      if (ot) options.push(ot);
    }
    if (control.tagName === 'SELECT') {
      var opts = control.options || [];
      var s;
      for (s = 0; s < opts.length; s++) {
        var label = clean(opts[s].textContent || opts[s].value);
        if (label && !/^select/i.test(label)) options.push(label);
      }
    }
    var question = questionFor(control, options);
    if (control.type === 'file' && /resume|cv/i.test(control.name + ' ' + control.id + ' ' + (control.getAttribute('data-ui') || ''))) question = 'Resume/CV';
    if (control.type === 'file' && /cover/i.test(control.name + ' ' + control.id + ' ' + (control.getAttribute('data-ui') || ''))) question = 'Cover Letter';
    if (control.type === 'tel' && (bloated(question) || !question)) question = 'Phone';
    if (bloated(question)) continue;
    if ((control.name === 'country' || control.id === 'country') && /phone/i.test(question || '')) question = 'Phone country code';
    if (!question || optionLike(question)) continue;
    var answered = grouped.length ? grouped.some(function (item) { return item.checked; }) : (control.type === 'file' ? !!(control.files && control.files.length) : !!(control.value && String(control.value).trim()));
    var required = !!(control.required || control.getAttribute('aria-required') === 'true');
    var style = window.getComputedStyle(control);
    var visible = style.display !== 'none' && style.visibility !== 'hidden' && control.type !== 'hidden';
    results.push({
      question: question,
      kind: kindOf(control, grouped.length ? inputType : ''),
      required: required,
      visible: visible,
      options: options,
      name: control.name || '',
      id: control.id || '',
      dataUi: control.getAttribute('data-ui') || control.getAttribute('data-field-path') || '',
      answered: answered,
      generatedName: generatedName(control.name),
      section: (function () {
        var section = control.closest('section, [class*="application-section"], [data-section]');
        if (!section) return '';
        var heading = section.querySelector('h2, h3, legend, [class*="section-title"]');
        return heading ? clean(heading.textContent) : '';
      })()
    });
  }
  var yesWidgets = form.querySelectorAll('.ashby-application-form-input-yesno, [class*="application-form-input-yesno"]');
  if (!yesWidgets.length) yesWidgets = document.querySelectorAll('.ashby-application-form-input-yesno, [class*="application-form-input-yesno"]');
  var y;
  for (y = 0; y < yesWidgets.length; y++) {
    var widget = yesWidgets[y];
    var entry = widget.closest('.ashby-application-form-field-entry, fieldset, [role="group"]');
    var titleNode = entry && entry.querySelector('.ashby-application-form-question-title, legend, .application-label .text');
    var title = clean((titleNode && titleNode.textContent) || (entry && entry.getAttribute('aria-label')) || '');
    if (!title || optionLike(title)) continue;
    var yesKey = 'boolean:g:' + title;
    if (seen[yesKey]) continue;
    var existingIndex = -1;
    var yi;
    for (yi = 0; yi < results.length; yi++) {
      if (results[yi].question !== title) continue;
      if (!results[yi].visible || results[yi].options.length < 2) { existingIndex = yi; break; }
      existingIndex = -2;
    }
    if (existingIndex === -2) continue;
    if (existingIndex >= 0) results.splice(existingIndex, 1);
    seen[yesKey] = true;
    results.push({
      question: title,
      kind: 'radio',
      required: !!(entry && entry.querySelector('[aria-required="true"], [required]')),
      visible: true,
      options: ['Yes', 'No'],
      name: '',
      id: '',
      dataUi: (entry && (entry.getAttribute('data-field-path') || entry.getAttribute('data-ui'))) || '',
      answered: !!(widget.querySelector('[aria-pressed="true"], [data-selected="true"], .selected')),
      generatedName: false,
      section: ''
    });
  }
  var hasTel = false;
  var p;
  for (p = 0; p < results.length; p++) if (results[p].kind === 'phone') hasTel = true;
  if (hasTel) {
    results = results.filter(function (item) {
      return !(item.kind === 'text' && /phone/i.test(item.question) && !/country/i.test(item.question));
    });
  }
  return results;
})()`
