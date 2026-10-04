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

  // ---------------------------------------------------------------
  // 1. Shorthand expansion. Plain code, not AI, so it is the same every
  //    time. Small models were misreading things like "R NOF" (right
  //    neck of femur) and "6/52" (6 weeks), so these are written out in
  //    full before any model sees the notes.
  // ---------------------------------------------------------------
  var SHORTHAND = [
    [/#\s?NOF\b/g, 'fractured neck of femur'],
    [/\bNOF\s?#/g, 'neck of femur fracture'],
    [/\b(\d+(?:\.\d+)?)\s?%\s*(?:on\s+)?RA\b/g, '$1% on room air'],
    [/\b1\/52\b/g, '1 week'], [/\b(\d+)\/52\b/g, '$1 weeks'],
    [/\b1\/7\b/g, '1 day'], [/\b(\d+)\/7\b/g, '$1 days'],
    [/\b1\/12\b/g, '1 month'], [/\b(\d+)\/12\b/g, '$1 months'],
    [/\bPOD\s?(\d{1,2})\b/g, 'post-operative day $1'],
    [/\bD(\d{1,2})\b/g, 'day $1'],
    [/\bNOF\b/g, 'neck of femur'],
    [/\bRIF\b/g, 'right iliac fossa'], [/\bLIF\b/g, 'left iliac fossa'],
    [/\bRUQ\b/g, 'right upper quadrant'], [/\bLUQ\b/g, 'left upper quadrant'],
    [/\bHb\b/g, 'haemoglobin'],
    [/\bBD\b/gi, 'twice daily'], [/\bTDS\b/gi, 'three times daily'],
    [/\bQDS\b/gi, 'four times daily'], [/\bOD\b/g, 'once daily'],
    [/\bPRN\b/gi, 'as needed'], [/\bPO\b/g, 'by mouth'], [/\bIV\b/g, 'intravenous'],
    [/\bIM\b/g, 'intramuscular'], [/\bSC\b/g, 'subcutaneous'],
    [/\bOT\b/g, 'occupational therapy'],
    [/\babx\b/gi, 'antibiotics'],
    [/\bco-amox\b/gi, 'co-amoxiclav'],
    [/\bCAP\b/g, 'community-acquired pneumonia'],
    [/\bUTI\b/g, 'urinary tract infection'],
    [/\bAF\b/g, 'atrial fibrillation'],
    [/\bMI\b/g, 'myocardial infarction'],
    [/\bHTN\b/g, 'hypertension'],
    [/\bT2DM\b/g, 'type 2 diabetes'], [/\bT1DM\b/g, 'type 1 diabetes'],
    [/\bSOB\b/g, 'shortness of breath'],
    [/\bCXR\b/g, 'chest X-ray'],
    [/\bsats\b/gi, 'oxygen saturations'],
    [/\br\/v\b/gi, 'review'], [/\bf\/u\b/gi, 'follow-up'], [/\bc\/o\b/gi, 'complaining of'],
    [/\bPMH\b/g, 'past medical history'], [/\bhx\b/gi, 'history'], [/\bDx\b/g, 'diagnosis'],
    [/\bNBM\b/g, 'nil by mouth'], [/\bMDT\b/g, 'multidisciplinary team'],
    [/\bTTO\b/g, 'medicines to take home'],
    [/\bNWB\b/g, 'non-weight-bearing'], [/\bFWB\b/g, 'full weight-bearing'],
    [/\bobs\b/gi, 'observations'], [/\bpt\b/g, 'patient']
  ];

  function expandShorthand(text) {
    var changes = [];
    function note(from, to) {
      var item = from.trim() + ' → ' + to.trim();
      if (from.trim() !== to.trim() && changes.indexOf(item) === -1) changes.push(item);
    }

    // Age and sex, e.g. "68F" or "72 M", at the start or after a comma/space.
    var out = String(text).replace(/(^|[\s,(])(\d{1,3})\s?([FM])\b/g, function (m, pre, age, sex) {
      if (+age > 120) return m;
      var to = age + '-year-old ' + (sex === 'F' ? 'woman' : 'man');
      note(m, to);
      return pre + to;
    });

    // Side, e.g. "R hemiarthroplasty" -> "right hemiarthroplasty".
    out = out.replace(/(^|[\s,(:;])([RL])(?=\s+[A-Za-z])/g, function (m, pre, side, offset, str) {
      if (/\d\s*$/.test(str.slice(0, offset + pre.length))) return m; // "2 L" means litres
      var to = side === 'R' ? 'right' : 'left';
      note(side, to);
      return pre + to;
    });

    SHORTHAND.forEach(function (rule) {
      out = out.replace(rule[0], function (m) {
        var to = m.replace(new RegExp(rule[0].source, rule[0].flags.replace('g', '')), rule[1]);
        note(m, to);
        return to;
      });
    });

    // "review 2 weeks" -> "review in 2 weeks"
    out = out.replace(/\b(review|clinic|follow-up|appointment)\s+(\d+ (?:days?|weeks?|months?))\b/gi, '$1 in $2');

    return { text: out, changes: changes };
  }

  // ---------------------------------------------------------------
  // 2. Fact check. Compares the draft with the notes and flags any
  //    number or date the AI added, and any number from the notes
  //    that went missing.
  // ---------------------------------------------------------------
  var NUMBER_WORDS = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
    seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50
  };
  var MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';

  function collectNumbers(text) {
    var found = {};
    (String(text).match(/\d+(?:\.\d+)?/g) || []).forEach(function (n) { found[String(parseFloat(n))] = true; });
    (String(text).toLowerCase().match(/\b[a-z]+\b/g) || []).forEach(function (w) {
      if (NUMBER_WORDS[w]) found[String(NUMBER_WORDS[w])] = true;
    });
    return found;
  }

  // Words that matter clinically if the AI gets them wrong: body parts,
  // side, and drug names. Adjective forms are mapped to one word so
  // "femoral" and "hip" count as "femur", for example.
  var ANATOMY = {
    femur: 'femur', femoral: 'femur', hip: 'femur', humerus: 'humerus', humeral: 'humerus',
    radius: 'radius', radial: 'radius', ulna: 'ulna', ulnar: 'ulna', tibia: 'tibia', tibial: 'tibia',
    fibula: 'fibula', pelvis: 'pelvis', pelvic: 'pelvis', spine: 'spine', spinal: 'spine',
    skull: 'skull', rib: 'rib', ribs: 'rib', clavicle: 'clavicle', scapula: 'scapula', patella: 'patella',
    wrist: 'wrist', ankle: 'ankle', knee: 'knee', elbow: 'elbow', shoulder: 'shoulder',
    hand: 'hand', foot: 'foot', arm: 'arm', leg: 'leg', shin: 'leg', chest: 'chest',
    abdomen: 'abdomen', abdominal: 'abdomen', lung: 'lung', lungs: 'lung', pulmonary: 'lung',
    heart: 'heart', cardiac: 'heart', kidney: 'kidney', renal: 'kidney', liver: 'liver', hepatic: 'liver',
    bowel: 'bowel', bladder: 'bladder', brain: 'brain', cerebral: 'brain', eye: 'eye', ear: 'ear'
  };
  var SIDES = { left: true, right: true, bilateral: true };
  var DRUG_SUFFIX = /(?:cillin|mycin|cycline|floxacin|azole|parin|pril|sartan|olol|dipine|statin|prazole|tidine|semide|thiazide|xaban|gatran|codone|profen|dronate|dronic|clav|mab|nib)$/i;
  var DRUG_WORDS = {
    paracetamol: true, aspirin: true, warfarin: true, insulin: true, metformin: true,
    prednisolone: true, codeine: true, morphine: true, salbutamol: true, clopidogrel: true,
    digoxin: true, levothyroxine: true, trimethoprim: true, nitrofurantoin: true, amiodarone: true
  };

  function termKey(word) {
    var w = word.toLowerCase();
    if (ANATOMY[w]) return 'a:' + ANATOMY[w];
    if (SIDES[w]) return 's:' + w;
    if (DRUG_WORDS[w] || (w.length > 5 && DRUG_SUFFIX.test(w))) return 'd:' + w;
    return null;
  }

  function collectTerms(text) {
    var found = {};
    (String(text).match(/[A-Za-z][A-Za-z-]*/g) || []).forEach(function (w) {
      var k = termKey(w);
      if (k) found[k] = true;
    });
    return found;
  }

  function renderChecked(letter, sourceText) {
    var source = collectNumbers(sourceText);
    var sourceTerms = collectTerms(sourceText);
    var sourceLower = String(sourceText).toLowerCase();
    var re = new RegExp('(\\[not documented[^\\]]*\\])|\\b(' + MONTHS + ')\\b|(\\d+(?:\\.\\d+)?)|([A-Za-z][A-Za-z-]*)', 'gi');
    var html = '';
    var last = 0;
    var added = [];

    function flag(m) {
      if (added.indexOf(m) === -1) added.push(m);
      return '<mark class="flag" title="Not in your notes. Check this.">' + escapeHtml(m) + '</mark>';
    }

    letter.replace(re, function (m, gap, month, num, word, offset) {
      html += escapeHtml(letter.slice(last, offset));
      if (gap) {
        html += '<mark>' + escapeHtml(m) + '</mark>';
      } else if (month) {
        html += sourceLower.indexOf(m.toLowerCase()) === -1 ? flag(m) : escapeHtml(m);
      } else if (num) {
        html += source[String(parseFloat(num))] ? escapeHtml(m) : flag(m);
      } else {
        var k = termKey(word);
        html += (k && !sourceTerms[k]) ? flag(m) : escapeHtml(m);
      }
      last = offset + m.length;
      return m;
    });
    html += escapeHtml(letter.slice(last));

    var inDraft = collectNumbers(letter);
    var missing = Object.keys(source).filter(function (n) { return !inDraft[n]; });
    return { html: html, added: added, missing: missing };
  }

  // ---------------------------------------------------------------
  // 3. The letter's frame is written by code: greeting, "Re:" line and
  //    sign-off. The AI only writes the body.
  // ---------------------------------------------------------------
  function cleanBody(raw) {
    var lines = String(raw).replace(/\r/g, '').split('\n').map(function (l) {
      return l.replace(/^\s*#+\s*/, '').replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1');
    });
    while (lines.length && (/^\s*$/.test(lines[0]) || /^\s*(dear\b|re:|to:|subject:|here is\b)/i.test(lines[0]))) {
      lines.shift();
    }
    var cut = -1;
    for (var i = 0; i < lines.length; i++) {
      if (/^\s*(yours (sincerely|faithfully)|kind regards|best wishes|many thanks|regards,?\s*$|\[doctor name\])/i.test(lines[i])) { cut = i; break; }
    }
    if (cut !== -1) lines = lines.slice(0, cut);
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function frameLetter(type, patient, recipient, body) {
    var toGP = /\bGP\b|general practi/i.test(recipient) || (!recipient && type !== 'referral');
    var greeting = toGP ? 'Dear Dr [GP name],' : 'Dear Colleague,';
    var who = String(patient || '').replace(/\s*\((?:fictional|made[- ]up)\)\s*/gi, ' ').trim();
    who = who ? who.charAt(0).toUpperCase() + who.slice(1) : '[Patient name]';
    return greeting + '\n\n' +
      'Re: ' + who + ', DOB [not documented]\n\n' +
      body + '\n\n' +
      'Yours sincerely,\n[Doctor name]';
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
    var opener = type === 'referral' ? '"Reason for referral:"' : '"Diagnosis:"';
    return 'You are a careful clinical documentation assistant helping a doctor draft a ' + label + '.\n\n' +
      'Rules:\n' +
      '- Write ONLY the body of the letter. Do not write a greeting ("Dear ..."), a "Re:" line or a sign-off; they are added automatically.\n' +
      '- Start with a ' + opener + ' line.\n' +
      '- Use only the information given. Never invent findings, results, names, dates, drugs, doses or history.\n' +
      '- If a standard detail is missing, write "[not documented]" instead of guessing.\n' +
      '- Abbreviations in the notes have already been written out in full. Keep them in full.\n' +
      '- Never turn a time period into a calendar date: "6 weeks" stays "6 weeks".\n' +
      '- Keep every number, drug name and dose exactly as written.\n' +
      '- Use clear, professional UK English. This is a first draft that a doctor will check.\n' +
      '- Output plain text only. No markdown.';
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
      patient: '54M (fictional)',
      recipient: "Patient's GP practice",
      notes: 'Admitted with RIF pain, diagnosed acute appendicitis\nLaparoscopic appendicectomy D1, uncomplicated\nEating and drinking, pain controlled with paracetamol\nWound clean and dry\nPlan: home today, GP r/v 2/52',
      body: 'Diagnosis: Acute appendicitis\n\nThis patient was admitted with right iliac fossa pain and was diagnosed with acute appendicitis. He underwent an uncomplicated laparoscopic appendicectomy on day 1.\n\nHe is now eating and drinking, and his pain is controlled with paracetamol. His wound is clean and dry.\n\nMedication on discharge: [not documented]\n\nFollow-up: He is going home today. Please review him in your practice in 2 weeks.'
    },
    referral: {
      patient: '63F (fictional)',
      recipient: 'Dermatology outpatient clinic',
      notes: 'Changing mole L shin for 3/12, larger and darker\nIrregular border, 9 mm across\nNo other skin lesions, no hx of skin cancer\nRequest: urgent assessment, possible melanoma',
      body: 'Reason for referral: Changing pigmented lesion on the left shin\n\nThank you for seeing this patient. She has had a mole on her left shin for 3 months that has become larger and darker. It has an irregular border and measures 9 mm across. She has no other skin lesions and no history of skin cancer.\n\nPast medical history and medication: [not documented]\n\nRequest: Urgent assessment for possible melanoma.'
    },
    clinic: {
      patient: '29F with migraine (fictional)',
      recipient: "Patient's GP",
      notes: 'Migraine review, 4 headaches a month, usually with nausea\nTriggers: poor sleep, stress\nStarted propranolol 40 mg BD\nAdvised headache diary\nf/u 3/12',
      body: 'Diagnosis: Migraine\n\nI reviewed this patient in clinic. She has about 4 headaches a month, usually with nausea. Her main triggers are poor sleep and stress.\n\nPlan: I have started propranolol 40 mg twice daily and advised her to keep a headache diary.\n\nAllergies: [not documented]\n\nFollow-up: I will see her again in 3 months.'
    }
  };

  function buildOnDeviceMessages(type, patient, recipient, notes) {
    var ex = WORKED_EXAMPLES[type] || WORKED_EXAMPLES.discharge;
    return [
      {
        role: 'system',
        content: buildSystemPrompt(type) + '\n' +
          '- Follow the layout of the example.\n' +
          '- Use ONLY the facts in the new notes. Never copy facts from the example.'
      },
      {
        role: 'user',
        content: buildUserPrompt(type, expandShorthand(ex.patient).text, ex.recipient, expandShorthand(ex.notes).text)
      },
      { role: 'assistant', content: ex.body },
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

  var report = $('check-report');

  function setOutput(text, html) {
    lastText = text;
    output.innerHTML = html || highlightGaps(text);
    output.classList.remove('is-empty');
  }

  function listHtml(items) {
    return items.map(function (x) { return '<code>' + escapeHtml(x) + '</code>'; }).join(', ');
  }

  // The report under the draft: fact check results and expanded shorthand.
  function showReport(check, changes) {
    var parts = [];
    var warn = false;
    if (check) {
      if (check.added.length) {
        warn = true;
        parts.push('<p><strong>Check the red parts.</strong> These aren\'t in your notes: ' + listHtml(check.added) + '.</p>');
      }
      if (check.missing.length) {
        warn = true;
        parts.push('<p><strong>Missing from the draft:</strong> these numbers from your notes don\'t appear: ' + listHtml(check.missing) + '.</p>');
      }
      if (!warn) {
        parts.push('<p><strong>Fact check passed.</strong> Every number, date, body part, side and drug in the draft is in your notes, and no numbers are missing. Still read every line.</p>');
      }
    }
    if (changes && changes.length) {
      parts.push('<details><summary>Shorthand written out before drafting (' + changes.length + ')</summary><p>' +
        listHtml(changes) + '</p></details>');
    }
    report.innerHTML = parts.join('');
    report.hidden = parts.length === 0;
    report.classList.toggle('is-warning', warn);
  }

  function setBusy(busy) {
    generateBtn.disabled = busy;
    generateBtn.textContent = busy ? 'Writing…' : 'Write draft';
    if (!busy) progressWrap.hidden = true;
  }

  $('generate-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    clearError();

    var rawPatient = $('patient-info').value.trim();
    var recipient = $('recipient').value.trim();
    var rawNotes = $('bullets').value.trim();
    var mode = currentMode();

    if (!rawNotes) {
      showError('Add at least one line of clinical notes first, or tap "Fill in an example".');
      return;
    }

    // Write out shorthand before anything else sees the notes.
    var expandedNotes = expandShorthand(rawNotes);
    var expandedPatient = expandShorthand(rawPatient);
    var notes = expandedNotes.text;
    var patient = expandedPatient.text;
    var changes = expandedPatient.changes.concat(expandedNotes.changes);

    if (mode === 'template') {
      setOutput(templateLetter(currentType, patient, recipient, notes));
      showReport(null, changes);
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
      var rawDraft;
      if (mode === 'claude') {
        setStatus('Asking Claude…');
        rawDraft = await writeWithClaude(apiKey, patient, recipient, notes);
        setPill('Claude', true);
        setStatus('');
      } else {
        var result = await writeOnDevice(mode, patient, recipient, notes);
        rawDraft = result.text;
        var name = MODEL_NAMES[result.modelId] || 'on-device model';
        setPill('On-device AI: ' + name, true);
        var fellBack = mode === 'pro' && TIERS.pro.indexOf(result.modelId) === -1;
        setStatus(fellBack ? 'Pro couldn\'t run on this device, so this draft used the standard model.' : '');
      }

      var letter = frameLetter(currentType, patient, recipient, cleanBody(rawDraft));
      var check = renderChecked(letter, [patient, recipient, notes].join('\n'));
      setOutput(letter, check.html);
      showReport(check, changes);
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
    report.hidden = true;
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

  // Exposed for testing in the browser console.
  window.__clinidraft = { expandShorthand: expandShorthand, renderChecked: renderChecked, frameLetter: frameLetter, cleanBody: cleanBody };

  runHero();
})();
