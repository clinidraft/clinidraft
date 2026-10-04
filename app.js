/*
 * Clinidraft
 * A static page: no server, nothing stored. Four ways to write a draft:
 *   template  - plain rules, no AI
 *   standard  - small open model running in the browser (WebLLM)
 *   pro       - larger open model in the browser, falls back to standard
 *   claude    - Anthropic API, using the visitor's own key
 */
(function () {
  'use strict';

  var LETTER_LABELS = {
    discharge: 'discharge summary',
    referral: 'referral letter',
    clinic: 'clinic letter'
  };

  // ---------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------
  function $(id) { return document.getElementById(id); }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // Highlight "[not documented]" (and "[not documented: ...]") gaps.
  function highlightGaps(text) {
    return escapeHtml(text).replace(/\[not documented[^\]]*\]/gi, function (m) {
      return '<mark>' + m + '</mark>';
    });
  }

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------------
  // Hero: the letter types itself after the notes are "written"
  // ---------------------------------------------------------------
  var HERO_LETTER =
    'Dear Dr [GP name],\n\n' +
    'Re: 68-year-old woman, DOB [not documented]\n\n' +
    'She was admitted with community-acquired pneumonia and treated with intravenous co-amoxiclav. ' +
    'She has been afebrile since day 2, and her CRP has fallen from 180 to 40. ' +
    'She moved to oral antibiotics on day 3 [not documented: course length].\n\n' +
    'She is mobilising independently, with oxygen saturations of 97% on room air.\n\n' +
    'She goes home today. Please review her in one week.\n\n' +
    'Yours sincerely,\n[Doctor name]';

  function runHero() {
    var target = $('hero-letter');
    if (!target) return;

    if (reduceMotion) {
      target.innerHTML = '<span>' + highlightGaps(HERO_LETTER) + '</span>';
      return;
    }

    // Invisible full copy reserves the space; the live copy types over it.
    target.innerHTML = '<span class="ghost">' + highlightGaps(HERO_LETTER) + '</span><span class="live"></span>';
    var live = target.querySelector('.live');
    var i = 0;
    function step() {
      i = Math.min(HERO_LETTER.length, i + 3);
      live.innerHTML = highlightGaps(HERO_LETTER.slice(0, i)) +
        (i < HERO_LETTER.length ? '<span class="caret"></span>' : '');
      if (i < HERO_LETTER.length) setTimeout(step, 16);
    }
    // Start once the handwritten notes have appeared.
    setTimeout(step, 2000);
  }

  // ---------------------------------------------------------------
  // Letter type (segmented radio group)
  // ---------------------------------------------------------------
  var currentType = 'discharge';
  var typeButtons = Array.prototype.slice.call(document.querySelectorAll('.segmented button'));

  function selectType(btn) {
    typeButtons.forEach(function (b) {
      var on = b === btn;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    currentType = btn.getAttribute('data-type');
  }

  typeButtons.forEach(function (btn, idx) {
    btn.tabIndex = idx === 0 ? 0 : -1;
    btn.addEventListener('click', function () { selectType(btn); });
    btn.addEventListener('keydown', function (e) {
      var dir = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 :
                (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      var next = typeButtons[(idx + dir + typeButtons.length) % typeButtons.length];
      selectType(next);
      next.focus();
    });
  });

  // ---------------------------------------------------------------
  // "Fill in an example" (fictional cases, one per letter type)
  // ---------------------------------------------------------------
  var FILL_EXAMPLES = {
    discharge: {
      patient: '68-year-old woman (fictional)',
      recipient: "Patient's GP practice",
      notes: [
        'Admitted with community-acquired pneumonia, started IV co-amoxiclav',
        'Afebrile since day 2, CRP falling from 180 to 40',
        'Stepped down to oral antibiotics on day 3',
        'Mobilising independently, sats 97% on air',
        'Plan: discharge today, GP review in 1 week'
      ]
    },
    referral: {
      patient: '72-year-old man (fictional)',
      recipient: 'Cardiology outpatient clinic',
      notes: [
        'Known atrial fibrillation, rate controlled on bisoprolol',
        'New exertional chest pain for 3 weeks, relieved by rest',
        'ECG: AF, no acute ST changes',
        'Troponin negative on two samples',
        'Request: outpatient assessment for ischaemia'
      ]
    },
    clinic: {
      patient: '15-year-old boy with asthma (fictional)',
      recipient: "Patient's GP, copied to parents",
      notes: [
        'Asthma review, night symptoms 3 times a week',
        'Using blue inhaler most days, peak flow 75% of predicted',
        'Inhaler technique poor, corrected with demonstration',
        'Started low-dose inhaled steroid',
        'Follow-up in 8 weeks with peak flow diary'
      ]
    }
  };

  $('example-btn').addEventListener('click', function () {
    var ex = FILL_EXAMPLES[currentType];
    $('patient-info').value = ex.patient;
    $('recipient').value = ex.recipient;
    $('bullets').value = ex.notes.join('\n');
    $('bullets').focus();
  });

  // ---------------------------------------------------------------
  // Mode selection
  // ---------------------------------------------------------------
  var modeInputs = Array.prototype.slice.call(document.querySelectorAll('input[name="mode"]'));
  var modeNote = $('mode-note');
  var apiKeyWrap = $('api-key-wrap');
  var modePill = $('mode-pill');

  var looksLikePhoneOrTablet =
    window.matchMedia('(pointer: coarse)').matches ||
    /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);

  var PILL_TEXT = {
    template: 'Template',
    standard: 'On-device AI',
    pro: 'On-device AI Pro',
    claude: 'Claude'
  };

  function currentMode() {
    for (var i = 0; i < modeInputs.length; i++) {
      if (modeInputs[i].checked) return modeInputs[i].value;
    }
    return 'template';
  }

  function setPill(text, isAi) {
    modePill.textContent = text;
    modePill.classList.toggle('is-ai', !!isAi);
  }

  function syncMode() {
    var mode = currentMode();
    apiKeyWrap.hidden = mode !== 'claude';
    modeNote.classList.remove('is-warning');

    if (mode === 'standard') {
      modeNote.hidden = false;
      modeNote.textContent = 'Runs a small AI model inside your browser, so your notes never leave this device. ' +
        'The first draft downloads about 1 GB, so use Wi-Fi, and keep this tab open with the screen on. ' +
        'Needs a recent browser with WebGPU.';
    } else if (mode === 'pro') {
      modeNote.hidden = false;
      modeNote.textContent = 'A larger model that writes noticeably better letters. It downloads about 2.5 GB and works best on a ' +
        'computer with Chrome or Edge. If it can\'t run, the draft is written with the standard model instead.';
      if (looksLikePhoneOrTablet) {
        modeNote.classList.add('is-warning');
        modeNote.textContent += ' This looks like a phone or tablet, where Pro will probably be too big. On-device AI (standard) is the safer choice here.';
      }
    } else {
      modeNote.hidden = true;
    }

    setPill(PILL_TEXT[mode], mode !== 'template');
  }

  modeInputs.forEach(function (input) { input.addEventListener('change', syncMode); });
  syncMode();

  // ---------------------------------------------------------------
  // Template mode: rules only, no AI. Says so on the draft.
  // ---------------------------------------------------------------
  function parseNotes(raw) {
    return raw.split('\n')
      .map(function (line) { return line.replace(/^[-*•–]\s*/, '').trim(); })
      .filter(Boolean);
  }

  function templateLetter(type, patient, recipient, notes) {
    var points = parseNotes(notes);
    var title = { discharge: 'Discharge summary', referral: 'Referral letter', clinic: 'Clinic letter' }[type];
    var closing = {
      discharge: 'Please continue care as above.',
      referral: 'I would be grateful for your assessment.',
      clinic: 'Follow-up as above.'
    }[type];

    return title + '\n' +
      '(Template draft: laid out by rules, no AI was used)\n\n' +
      'To: ' + (recipient || '[not documented]') + '\n' +
      'Patient: ' + (patient || '[not documented]') + '\n\n' +
      'Notes:\n' +
      points.map(function (p) { return '  • ' + p; }).join('\n') + '\n\n' +
      closing + '\n\n' +
      'Yours sincerely,\n[Doctor name]';
  }

  // ---------------------------------------------------------------
  // Prompts shared by the AI modes
  // ---------------------------------------------------------------
  function buildSystemPrompt(type) {
    var label = LETTER_LABELS[type] || 'clinical letter';
    return 'You are a careful clinical documentation assistant helping a doctor draft a ' + label + '.\n\n' +
      'Rules:\n' +
      '- Use only the information given. Never invent findings, results, names, dates, drugs, doses or history.\n' +
      '- If a standard detail is missing, write "[not documented]" instead of guessing.\n' +
      '- Expand common medical abbreviations into plain clinical English.\n' +
      '- Use clear, professional UK clinical letter style.\n' +
      '- This is a first draft that a doctor will check and edit.\n' +
      '- Output only the letter text. No preamble and no markdown.';
  }

  function buildUserPrompt(type, patient, recipient, notes) {
    var label = LETTER_LABELS[type] || 'clinical letter';
    return [
      'Draft a ' + label + '.',
      patient ? 'Patient details: ' + patient : '',
      recipient ? 'Recipient: ' + recipient : '',
      'Clinical notes:\n' + notes
    ].filter(Boolean).join('\n\n');
  }

  // Worked examples for the on-device models. Small models follow a
  // complete example far better than rules alone. These cases are
  // different from the "Fill in an example" ones on purpose.
  var WORKED_EXAMPLES = {
    discharge: {
      patient: '54-year-old man (fictional)',
      recipient: "Patient's GP practice",
      notes: 'Admitted with RIF pain, diagnosed acute appendicitis\nLaparoscopic appendicectomy day 1, uncomplicated\nEating and drinking, pain controlled with paracetamol\nWound clean and dry\nPlan: home today, GP review in 2 weeks',
      letter: 'Dear Dr [GP name],\n\nRe: 54-year-old man, DOB [not documented]\n\nDiagnosis: Acute appendicitis\n\nThis patient was admitted with right iliac fossa pain and was diagnosed with acute appendicitis. He underwent an uncomplicated laparoscopic appendicectomy on day 1.\n\nHe is now eating and drinking, and his pain is controlled with paracetamol. His wound is clean and dry.\n\nMedication on discharge: [not documented]\n\nFollow-up: He is being discharged home today. Please review him in your practice in 2 weeks.\n\nYours sincerely,\n[Doctor name]'
    },
    referral: {
      patient: '63-year-old woman (fictional)',
      recipient: 'Dermatology outpatient clinic',
      notes: 'Changing mole on left shin for 3 months, larger and darker\nIrregular border, 9 mm across\nNo other skin lesions, no history of skin cancer\nRequest: urgent assessment, possible melanoma',
      letter: 'Dear Colleague,\n\nRe: 63-year-old woman, DOB [not documented]\n\nReason for referral: Changing pigmented lesion on the left shin\n\nThank you for seeing this patient. She has had a mole on her left shin for 3 months that has become larger and darker. It has an irregular border and measures 9 mm across. She has no other skin lesions and no personal history of skin cancer.\n\nPast medical history and medication: [not documented]\n\nRequest: Urgent assessment for possible melanoma.\n\nYours sincerely,\n[Doctor name]'
    },
    clinic: {
      patient: '29-year-old woman with migraine (fictional)',
      recipient: "Patient's GP",
      notes: 'Migraine review, 4 headaches a month, usually with nausea\nTriggers: poor sleep, stress\nStarted propranolol 40 mg BD\nAdvised headache diary\nFollow-up 3 months',
      letter: 'Dear Dr [GP name],\n\nRe: 29-year-old woman, DOB [not documented]\n\nDiagnosis: Migraine\n\nI reviewed this patient in clinic. She has about 4 headaches a month, usually with nausea. Her main triggers are poor sleep and stress.\n\nPlan: I have started propranolol 40 mg twice daily and advised her to keep a headache diary.\n\nAllergies: [not documented]\n\nFollow-up: I will see her again in 3 months.\n\nYours sincerely,\n[Doctor name]'
    }
  };

  function buildOnDeviceMessages(type, patient, recipient, notes) {
    var ex = WORKED_EXAMPLES[type] || WORKED_EXAMPLES.discharge;
    return [
      {
        role: 'system',
        content: buildSystemPrompt(type) + '\n' +
          '- Follow the layout of the example letter.\n' +
          '- Use ONLY the facts in the new notes. Never copy facts from the example.\n' +
          '- Keep every number, drug name and dose exactly as written.'
      },
      { role: 'user', content: buildUserPrompt(type, ex.patient, ex.recipient, ex.notes) },
      { role: 'assistant', content: ex.letter },
      { role: 'user', content: buildUserPrompt(type, patient, recipient, notes) }
    ];
  }

  // ---------------------------------------------------------------
  // On-device AI (WebLLM). Only downloaded if someone picks it.
  // Model names are checked against the library's own list at run time.
  // ---------------------------------------------------------------
  var WEBLLM_URL = 'https://esm.run/@mlc-ai/web-llm';

  var TIERS = {
    standard: [
      'Llama-3.2-1B-Instruct-q4f16_1-MLC',
      'Llama-3.2-1B-Instruct-q4f32_1-MLC',
      'Qwen2.5-1.5B-Instruct-q4f16_1-MLC'
    ],
    pro: [
      'Llama-3.2-3B-Instruct-q4f16_1-MLC',
      'Llama-3.2-3B-Instruct-q4f32_1-MLC'
    ]
  };

  var MODEL_NAMES = {
    'Llama-3.2-1B-Instruct-q4f16_1-MLC': 'Llama 3.2 1B',
    'Llama-3.2-1B-Instruct-q4f32_1-MLC': 'Llama 3.2 1B',
    'Qwen2.5-1.5B-Instruct-q4f16_1-MLC': 'Qwen 2.5 1.5B',
    'Llama-3.2-3B-Instruct-q4f16_1-MLC': 'Llama 3.2 3B',
    'Llama-3.2-3B-Instruct-q4f32_1-MLC': 'Llama 3.2 3B'
  };

  var wl = { lib: null, engine: null, modelId: null, startAt: { standard: 0, pro: 0 } };
  var progressWrap = $('progress');
  var progressBar = $('progress-bar');

  function setProgress(fraction) {
    progressWrap.hidden = false;
    progressBar.style.width = Math.round(Math.max(0, Math.min(1, fraction)) * 100) + '%';
  }

  async function loadLibrary() {
    if (wl.lib) return wl.lib;
    if (!('gpu' in navigator)) {
      throw new Error('This browser doesn\'t support WebGPU, which on-device AI needs. Try a recent version of Chrome or Edge on a computer, or choose Template or Claude.');
    }
    setStatus('Loading the AI library…');
    try {
      wl.lib = await import(WEBLLM_URL);
    } catch (e) {
      throw new Error('Couldn\'t download the AI library. Check your internet connection and try again.');
    }
    return wl.lib;
  }

  async function candidatesFor(tier) {
    var lib = await loadLibrary();
    var available = ((lib.prebuiltAppConfig && lib.prebuiltAppConfig.model_list) || [])
      .map(function (m) { return m.model_id; });
    var wanted = tier === 'pro' ? TIERS.pro.concat(TIERS.standard) : TIERS.standard;
    return wanted.filter(function (id) { return available.indexOf(id) !== -1; });
  }

  async function discardEngine() {
    var old = wl.engine;
    wl.engine = null;
    wl.modelId = null;
    if (old && typeof old.unload === 'function') {
      try { await old.unload(); } catch (e) { /* already gone */ }
    }
  }

  async function ensureEngine(modelId) {
    if (wl.engine && wl.modelId === modelId) return wl.engine;
    await discardEngine();
    setStatus('Downloading ' + (MODEL_NAMES[modelId] || 'the model') + '. This only happens once; keep this tab open…');
    setProgress(0);
    var engine = await wl.lib.CreateMLCEngine(modelId, {
      initProgressCallback: function (report) {
        setProgress(report.progress || 0);
      }
    });
    wl.engine = engine;
    wl.modelId = modelId;
    return engine;
  }

  // Errors that mean the browser dropped the model or graphics connection,
  // rather than a problem with what was typed.
  function isDroppedModelError(err) {
    return /model not loaded|reload|device.*lost|context lost|out of memory|memory|mapasync|unmapped|gpubuffer|gpudevice|webgpu|allocation/i
      .test((err && err.message) || '');
  }

  async function writeOnDevice(tier, patient, recipient, notes) {
    var candidates = await candidatesFor(tier);
    if (!candidates.length) {
      throw new Error('The expected AI models aren\'t available in this version of the library. Try Template or Claude.');
    }

    var MAX_ATTEMPTS = 3;
    var attempts = 0;
    for (var i = Math.min(wl.startAt[tier], candidates.length - 1); i < candidates.length && attempts < MAX_ATTEMPTS; i++) {
      attempts++;
      var modelId = candidates[i];
      try {
        var engine = await ensureEngine(modelId);
        progressWrap.hidden = true;
        setStatus('Writing the draft…');
        var reply = await engine.chat.completions.create({
          messages: buildOnDeviceMessages(currentType, patient, recipient, notes),
          temperature: 0.1,
          max_tokens: 700
        });
        wl.startAt[tier] = i; // remember what worked on this device
        return { text: reply.choices[0].message.content, modelId: modelId };
      } catch (err) {
        if (!isDroppedModelError(err)) {
          if (/fetch|network|load failed/i.test((err && err.message) || '')) {
            throw new Error('The model download was interrupted. Check your connection and try again.');
          }
          throw err;
        }
        await discardEngine();
        setStatus('That model stopped, so trying a lighter one…');
      }
    }
    throw new Error('The on-device model kept stopping. This usually means the device ran out of memory or the screen turned off. ' +
      'Close other tabs and apps, keep the screen on and try again, or choose Template or Claude.');
  }

  // ---------------------------------------------------------------
  // Claude mode
  // ---------------------------------------------------------------
  async function writeWithClaude(apiKey, patient, recipient, notes) {
    var res;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-5',
          max_tokens: 1024,
          system: buildSystemPrompt(currentType),
          messages: [{ role: 'user', content: buildUserPrompt(currentType, patient, recipient, notes) }]
        })
      });
    } catch (e) {
      throw new Error('Couldn\'t reach Claude. Check your internet connection.');
    }
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      throw new Error((data.error && data.error.message) || 'Claude returned an error.');
    }
    return (data.content || []).map(function (b) { return b.text || ''; }).join('');
  }

  // ---------------------------------------------------------------
  // Form handling and output
  // ---------------------------------------------------------------
  var output = $('letter-output');
  var errorBox = $('error');
  var generateBtn = $('generate-btn');
  var statusEl = $('status');
  var lastText = '';

  function setStatus(text) { statusEl.textContent = text || ''; }

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.hidden = false;
  }

  function clearError() {
    errorBox.textContent = '';
    errorBox.hidden = true;
  }

  function setOutput(text) {
    lastText = text;
    output.innerHTML = highlightGaps(text);
    output.classList.remove('is-empty');
  }

  function setBusy(busy) {
    generateBtn.disabled = busy;
    generateBtn.textContent = busy ? 'Writing…' : 'Write draft';
    if (!busy) progressWrap.hidden = true;
  }

  $('generate-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    clearError();

    var patient = $('patient-info').value.trim();
    var recipient = $('recipient').value.trim();
    var notes = $('bullets').value.trim();
    var mode = currentMode();

    if (!notes) {
      showError('Add at least one line of clinical notes first, or tap "Fill in an example".');
      return;
    }

    if (mode === 'template') {
      setOutput(templateLetter(currentType, patient, recipient, notes));
      setPill('Template', false);
      setStatus('');
      return;
    }

    var apiKey = $('api-key').value.trim();
    if (mode === 'claude' && !apiKey) {
      showError('Enter a Claude API key, or choose another way to write the draft.');
      return;
    }

    setBusy(true);
    try {
      if (mode === 'claude') {
        setStatus('Asking Claude…');
        setOutput(await writeWithClaude(apiKey, patient, recipient, notes));
        setPill('Claude', true);
        setStatus('');
      } else {
        var result = await writeOnDevice(mode, patient, recipient, notes);
        setOutput(result.text);
        var name = MODEL_NAMES[result.modelId] || 'on-device model';
        setPill('On-device AI: ' + name, true);
        var fellBack = mode === 'pro' && TIERS.pro.indexOf(result.modelId) === -1;
        setStatus(fellBack ? 'Pro couldn\'t run on this device, so this draft used the standard model.' : '');
      }
    } catch (err) {
      setStatus('');
      showError((err && err.message) || 'Something went wrong writing the draft.');
    } finally {
      setBusy(false);
    }
  });

  $('clear-btn').addEventListener('click', function () {
    lastText = '';
    output.textContent = 'Your draft will appear here.';
    output.classList.add('is-empty');
    clearError();
    setStatus('');
    syncMode();
  });

  $('copy-btn').addEventListener('click', function () {
    if (!lastText) return;
    var btn = this;
    function done() {
      btn.textContent = 'Copied';
      setTimeout(function () { btn.textContent = 'Copy'; }, 1500);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(lastText).then(done, function () {});
    }
  });

  runHero();
})();
