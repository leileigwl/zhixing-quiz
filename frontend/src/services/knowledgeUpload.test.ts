import { describe, expect, it } from 'vitest'
import { KB_MAX_FILE_SIZE, KB_MSG, checkKnowledgeFile } from './knowledgeUpload'

describe('checkKnowledgeFile', () => {
  it.each(['笔记.pdf', 'a.DOCX', 'readme.md', 'x.txt'])('接受 %s', (name) => {
    const res = checkKnowledgeFile(name, 100)
    expect(res.ok).toBe(true)
  })
  it('拒绝不支持的类型', () => {
    expect(checkKnowledgeFile('a.ppt', 100)).toEqual({ ok: false, message: KB_MSG.badType })
    expect(checkKnowledgeFile('pdf', 100)).toEqual({ ok: false, message: KB_MSG.badType })
  })
  it('拒绝空文件与超大文件', () => {
    expect(checkKnowledgeFile('a.pdf', 0)).toEqual({ ok: false, message: KB_MSG.empty })
    expect(checkKnowledgeFile('a.pdf', KB_MAX_FILE_SIZE + 1)).toEqual({ ok: false, message: KB_MSG.tooLarge })
  })
})
