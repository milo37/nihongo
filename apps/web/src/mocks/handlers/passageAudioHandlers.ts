import { http, HttpResponse } from 'msw'
import { mockPassageAudioMarks, mockSilentWav } from '@mocks/data/passageAudio'

const notFound = () => new HttpResponse(null, { status: 404 })

// #1183 mock of the same-site files (#1219). Media elements ask for byte
// ranges, and Safari will not play a file that ignores them, so a Range
// request gets 206.
export const passageAudioHandlers = [
  http.get('*/audio/passages/:file', ({ params, request }) => {
    const file = String(params.file)
    const [, key, kind] = /^(.+)\.(mp3|marks\.json)$/u.exec(file) ?? []
    const marks = key ? mockPassageAudioMarks(key) : null
    if (!marks) return notFound()
    if (kind === 'marks.json') return HttpResponse.json(marks)
    const body = mockSilentWav(marks.durationMs)
    const range = /^bytes=(\d*)-(\d*)$/u.exec(
      request.headers.get('range') ?? ''
    )
    if (!range) {
      return new HttpResponse(body, {
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Length': String(body.length),
          'Content-Type': 'audio/wav'
        }
      })
    }
    const start = range[1] ? Number(range[1]) : 0
    const end = Math.min(
      range[2] ? Number(range[2]) : body.length - 1,
      body.length - 1
    )
    if (start > end) {
      return new HttpResponse(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${body.length}` }
      })
    }
    return new HttpResponse(body.slice(start, end + 1), {
      status: 206,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${body.length}`,
        'Content-Type': 'audio/wav'
      }
    })
  })
]
