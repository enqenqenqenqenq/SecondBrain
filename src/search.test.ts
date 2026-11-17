import { describe, expect, it } from 'vitest'
import {
  findRanges,
  fold,
  foldedFor,
  makeSnippet,
  matches,
  parseQuery,
  splitByRanges,
} from './search'

const hit = (text: string, query: string) => matches(fold(text), parseQuery(query))

describe('разбор запроса', () => {
  it('разбивает на слова и убирает лишние пробелы', () => {
    expect(parseQuery('  Купить   Хлеб ')).toEqual(['купить', 'хлеб'])
  })

  it('пустой и пробельный запрос даёт пустой список', () => {
    expect(parseQuery('')).toEqual([])
    expect(parseQuery('   ')).toEqual([])
  })
})

describe('что считается совпадением', () => {
  it('не зависит от регистра', () => {
    expect(hit('Позвонить ПОСЛЕ работы', 'после')).toBe(true)
    expect(hit('позвонить после работы', 'ПОЗВОНИТЬ')).toBe(true)
  })

  it('буквы «е» и «ё» равнозначны', () => {
    expect(hit('Ёлка на площади', 'елка')).toBe(true)
    expect(hit('Всё готово', 'все')).toBe(true)
    expect(hit('Все готово', 'всё')).toBe(true)
  })

  it('находит часть слова', () => {
    expect(hit('Позвонить после работы', 'звон')).toBe(true)
  })

  it('все слова запроса должны быть в записи, порядок не важен', () => {
    expect(hit('Купить хлеб и молоко', 'молоко хлеб')).toBe(true)
    expect(hit('Купить хлеб', 'хлеб молоко')).toBe(false)
  })

  it('пустой запрос подходит всем записям', () => {
    expect(hit('что угодно', '')).toBe(true)
  })

  it('отсутствующее слово не находится', () => {
    expect(hit('Позвонить', 'написать')).toBe(false)
  })

  it('символы разметки в запросе ищутся как обычный текст', () => {
    expect(hit('цена (в рублях) [100]', '(в')).toBe(true)
    expect(hit('цена (в рублях) [100]', '[100]')).toBe(true)
    expect(hit('абвгд', '.*')).toBe(false)
    expect(hit('файл a+b.txt', 'a+b.txt')).toBe(true)
  })
})

describe('места совпадений', () => {
  it('номера знаков совпадают с исходным текстом при любом регистре и «ё»', () => {
    const text = 'Всё ГОТОВО, Ёлка'
    expect(findRanges(text, parseQuery('готово ёлка'))).toEqual([
      { start: 4, end: 10 },
      { start: 12, end: 16 },
    ])
  })

  it('повторы находятся все', () => {
    expect(findRanges('да нет да', ['да'])).toEqual([
      { start: 0, end: 2 },
      { start: 7, end: 9 },
    ])
  })

  it('пересекающиеся и соседние места склеиваются', () => {
    expect(findRanges('абвгд', ['абв', 'вгд'])).toEqual([{ start: 0, end: 5 }])
    expect(findRanges('абвгд', ['аб', 'вг'])).toEqual([{ start: 0, end: 4 }])
  })

  it('эмодзи не сдвигают номера знаков', () => {
    expect(findRanges('🙂 привет 🙂 мир', ['мир'])).toEqual([{ start: 13, end: 16 }])
  })

  it('без слов мест нет', () => {
    expect(findRanges('текст', [])).toEqual([])
  })
})

describe('подсветка', () => {
  it('делит текст на обычные и подсвеченные части', () => {
    const text = 'Позвонить после работы'
    const parts = splitByRanges(text, findRanges(text, ['после']))
    expect(parts).toEqual([
      { text: 'Позвонить ', mark: false },
      { text: 'после', mark: true },
      { text: ' работы', mark: false },
    ])
    expect(parts.map((p) => p.text).join('')).toBe(text)
  })

  it('совпадение в начале и в конце', () => {
    const text = 'аб в аб'
    const parts = splitByRanges(text, findRanges(text, ['аб']))
    expect(parts.map((p) => p.mark)).toEqual([true, false, true])
  })

  it('без совпадений весь текст обычный', () => {
    expect(splitByRanges('текст', [])).toEqual([{ text: 'текст', mark: false }])
  })
})

describe('кусок вокруг совпадения', () => {
  const long = 'начало '.repeat(100) + 'ИСКОМОЕ слово ' + 'конец '.repeat(100)

  it('короткая запись остаётся целой', () => {
    const ranges = findRanges('коротко искомое', ['искомое'])
    expect(makeSnippet('коротко искомое', ranges)).toEqual({ text: 'коротко искомое', ranges })
  })

  it('у длинной записи показывается кусок с многоточиями, совпадение внутри', () => {
    const ranges = findRanges(long, ['искомое'])
    const snippet = makeSnippet(long, ranges)
    expect(snippet.text.length).toBeLessThanOrEqual(202)
    expect(snippet.text.startsWith('…')).toBe(true)
    expect(snippet.text.endsWith('…')).toBe(true)
    const [first] = snippet.ranges
    expect(snippet.text.slice(first.start, first.end)).toBe('ИСКОМОЕ')
  })

  it('совпадение в начале длинной записи не даёт лишнего многоточия слева', () => {
    const text = 'искомое ' + 'слово '.repeat(100)
    const snippet = makeSnippet(text, findRanges(text, ['искомое']))
    expect(snippet.text.startsWith('…')).toBe(false)
    expect(snippet.text.endsWith('…')).toBe(true)
    expect(snippet.ranges[0]).toEqual({ start: 0, end: 7 })
  })

  it('совпадения за пределами куска отбрасываются', () => {
    const text = 'слово ' + 'вода '.repeat(150) + 'слово'
    const snippet = makeSnippet(text, findRanges(text, ['слово']))
    expect(snippet.ranges).toHaveLength(1)
  })
})

describe('скорость на большом объёме', () => {
  it('поиск по 5000 записей занимает доли секунды', () => {
    const words =
      'встреча идея купить позвонить работа проект кофе вечер парк книга фильм врач'.split(' ')
    let seed = 7
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296
    const texts = Array.from({ length: 5000 }, () =>
      Array.from(
        { length: 5 + Math.floor(rnd() * 50) },
        () => words[Math.floor(rnd() * words.length)],
      ).join(' '),
    )
    const started = performance.now()
    const query = parseQuery('Кофе вечер')
    const found = texts.filter((t) => matches(fold(t), query))
    const elapsed = performance.now() - started
    expect(found.length).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(300)
  })
})

describe('запоминание приведённого текста', () => {
  it('для той же версии записи отдаёт то же, для новой версии пересчитывает', () => {
    expect(foldedFor('запись-1', 1, 'Один')).toBe('один')
    expect(foldedFor('запись-1', 1, 'Другой текст, версия не менялась')).toBe('один')
    expect(foldedFor('запись-1', 2, 'Два')).toBe('два')
  })

  it('разные записи не путаются', () => {
    expect(foldedFor('запись-а', 1, 'Альфа')).toBe('альфа')
    expect(foldedFor('запись-б', 1, 'Бета')).toBe('бета')
  })
})
