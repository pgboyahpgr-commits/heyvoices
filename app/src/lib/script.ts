// Screenplay-style script parser for Story mode.
//
// Understands the common ways people tag speakers in scripts:
//   NARRATOR: Once upon a time...        (colon)
//   [ALEX] No way.                       (brackets)
//   **MARA:** We go together.            (bold markdown)
//   ALEX — Then we go together.          (em/en dash)
//
// Untagged lines continue the previous speaker (multi-line paragraphs).
// Lines of --- or *** are treated as scene breaks and dropped.
//
// False-positive guard: a "NAME:" line only counts as a speaker tag when the
// name is ALL CAPS, appears at least twice, or stands alone on its line —
// so dialogue like "Well: that's fine." stays dialogue.

export interface ScriptLine {
  speaker: string | null
  text: string
}

export interface ParsedScript {
  lines: ScriptLine[]
  speakers: string[]   // first-appearance order
  tagged: boolean
}

interface Candidate {
  name: string
  text: string
}

const BRACKET_RE = /^\s*\[([^\]\n]{1,40})\]\s*[:：]?\s*(.*)$/
const COLON_RE = /^\s*\*{0,2}([A-Za-z0-9 .'_-]{1,28}?)\*{0,2}\s*(?::|—|–)\s*(.*)$/
const BREAK_RE = /^[-*_=]{3,}$/

export function parseScript(input: string): ParsedScript {
  const raw = input.replace(/\r\n/g, '\n').split('\n')

  const counts = new Map<string, number>()
  const candidates: (Candidate | null)[] = raw.map((ln) => {
    const b = ln.match(BRACKET_RE)
    if (b) return { name: b[1].trim(), text: b[2].trim() }
    const c = ln.match(COLON_RE)
    if (c) {
      const name = c[1].trim().replace(/\*+$/, '').trim()
      if (!name) return null
      const key = name.toLowerCase()
      counts.set(key, (counts.get(key) || 0) + 1)
      return { name, text: c[2].trim() }
    }
    return null
  })

  const isTag = (c: Candidate): boolean => {
    if (/^[A-Z0-9 .'_-]{2,}$/.test(c.name) && /[A-Z]/.test(c.name)) return true  // ALL CAPS
    if ((counts.get(c.name.toLowerCase()) || 0) >= 2) return true                 // repeats
    if (!c.text) return true                                                      // name-only line
    return false
  }

  const lines: ScriptLine[] = []
  const speakers: string[] = []
  let tagged = false

  for (let i = 0; i < raw.length; i++) {
    const ln = raw[i].trim()
    if (!ln || BREAK_RE.test(ln)) continue
    const c = candidates[i]
    if (c && isTag(c)) {
      tagged = true
      if (!speakers.some((s) => s.toLowerCase() === c.name.toLowerCase())) {
        speakers.push(c.name)
      }
      lines.push({ speaker: c.name, text: c.text })
      continue
    }
    if (lines.length) {
      const last = lines[lines.length - 1]
      last.text = last.text ? `${last.text} ${ln}` : ln
    } else {
      lines.push({ speaker: null, text: ln })
    }
  }

  if (!tagged) {
    // No speaker tags — split into paragraphs so single-voice scripts still
    // become one line per paragraph (better pacing + per-line editing).
    const paras = input
      .replace(/\r\n/g, '\n')
      .split(/\n\s*\n/)
      .map((p) => p.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    if (paras.length > 1) {
      return { lines: paras.map((p) => ({ speaker: null, text: p })), speakers: [], tagged: false }
    }
    return { lines, speakers: [], tagged: false }
  }

  return { lines, speakers, tagged }
}
