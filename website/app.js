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
