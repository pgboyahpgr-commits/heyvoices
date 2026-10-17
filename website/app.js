/* HeyVoices landing page — voice demo players + scroll effects. */
(function () {
  'use strict'

  /* ---------- voice demo players ---------- */
  var cards = Array.prototype.slice.call(document.querySelectorAll('.voice-card'))
  var current = null

  function fmt(s) {
    if (!isFinite(s)) s = 0
    var m = Math.floor(s / 60)
    var r = Math.floor(s % 60)
    return m + ':' + (r < 10 ? '0' : '') + r
  }

  function stop(card) {
    if (!card) return
    var audio = card._audio
    if (audio) { audio.pause(); audio.currentTime = 0 }
    card.classList.remove('playing')
    var bar = card.querySelector('.voice-track .bar i')
    var t = card.querySelector('.voice-track .t')
    if (bar) bar.style.width = '0%'
    if (t) t.textContent = '0:00'
  }

  cards.forEach(function (card) {
    var audio = new Audio(card.getAttribute('data-src'))
    audio.preload = 'metadata'
    card._audio = audio
    var btn = card.querySelector('.voice-play')
    var bar = card.querySelector('.voice-track .bar i')
    var t = card.querySelector('.voice-track .t')

    btn.addEventListener('click', function () {
      if (card.classList.contains('playing')) {
        stop(card)
        return
      }
      if (current && current !== card) stop(current)
      current = card
      card.classList.add('playing')
      audio.play().catch(function () {
        /* autoplay/network hiccup — reset quietly */
        stop(card)
      })
    })

    audio.addEventListener('loadedmetadata', function () {
      if (t && !card.classList.contains('playing')) t.textContent = fmt(audio.duration)
    })

    audio.addEventListener('timeupdate', function () {
      var d = audio.duration || 0
      if (bar) bar.style.width = (d ? (audio.currentTime / d) * 100 : 0) + '%'
      if (t) t.textContent = fmt(audio.currentTime)
    })

    audio.addEventListener('ended', function () {
      stop(card)
      if (current === card) current = null
    })
  })

  /* ---------- nav shadow on scroll ---------- */
  var nav = document.getElementById('nav')
  function onScroll() {
    if (window.scrollY > 8) nav.classList.add('scrolled')
    else nav.classList.remove('scrolled')
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()

  /* ---------- emotion demo (real assistant outputs) ---------- */
  var EMO = {
    excited: {
      script: '\u201CHalt! Who goes there? Oh, it is you. We have been waiting for a hero.\u201D',
      prompt: '\u201CSpeak with high energy and real enthusiasm, a quick and rhythmic pace, bright rising intonation, and a punchy emphasis on the key words.\u201D'
    },
    whisper: {
      script: '\u201Cనమస్తే! ఈ రోజు మనం ఒక కొత్త విషయం గురించి మాట్లాడుకుందాం.\u201D',
      prompt: '\u201CSpeak in a soft, breathy whisper with Kavya\u2019s gentle, intimate tone, maintaining a slow and rhythmic flow.\u201D'
    },
    narration: {
      script: '\u201CThe wind carried the smell of rain across the valley, and for a moment, everything was still.\u201D',
      prompt: '\u201CSpeak with warm, soothing tones, a gentle pace, and a soft, inviting intonation to convey the warmth of the audiobook narrator.\u201D'
    },
    gaming: {
      script: '\u201CHalt! Who goes there? Oh, it is you. We have been waiting for a hero.\u201D',
      prompt: '\u201CSpeak with dramatic intensity, theatrical flair, and full expression matching the character\u2019s tone, delivering the script with a controlled, immersive energy.\u201D'
    },
    news: {
      script: '\u201CGood evening. Heavy rain is expected across the region tonight, with winds picking up after midnight.\u201D',
      prompt: '\u201CSpeak with crisp confidence, a steady pace, and a clear, confident delivery of the key phrases.\u201D'
    },
    devotional: {
      script: '\u201Cసర్వే జనాః సుఖినో భవంతు. శాంతి, సౌఖ్యం, సమృద్ధి అందరికీ లభించాలి.\u201D',
      prompt: '\u201CSpeak with a calm, respectful tone, slow and deliberate pacing, maintaining a soft, heartfelt resonance throughout the script.\u201D'
    }
  }

  var emoChips = Array.prototype.slice.call(document.querySelectorAll('.emo-chip'))
  var emoScript = document.getElementById('emoScript')
  var emoPrompt = document.getElementById('emoPrompt')

  emoChips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      emoChips.forEach(function (c) { c.classList.remove('on') })
      chip.classList.add('on')
      var d = EMO[chip.getAttribute('data-emo')]
      if (!d || !emoScript || !emoPrompt) return
      emoScript.textContent = d.script
      emoPrompt.textContent = d.prompt
      ;[emoScript, emoPrompt].forEach(function (el) {
        el.classList.remove('flash')
        void el.offsetWidth
        el.classList.add('flash')
      })
    })
  })

  /* ---------- reveal on scroll ---------- */
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add('in')
            io.unobserve(e.target)
          }
        })
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    )
    document.querySelectorAll('.reveal').forEach(function (el) { io.observe(el) })
  } else {
    document.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('in') })
  }
})()
