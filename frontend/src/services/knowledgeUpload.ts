/** 知识口袋上传的前端校验（口袋页与首页「导入参考资料」弹层共用；后端 knowledge_service 会再校验一次） */

export const KB_SUPPORTED_EXTENSIONS = ['pdf', 'docx', 'md', 'txt'] as const
export const KB_ACCEPT = '.pdf,.docx,.md,.txt'
export const KB_MAX_FILE_SIZE = 10 * 1024 * 1024

export const KB_MSG = {
  badType: '仅支持 PDF / Word / Markdown / TXT 文件',
  empty: '文件内容不能为空',
  tooLarge: '文件大小不能超过 10MB',
} as const

export type KbFileCheck = { ok: true; ext: string } | { ok: false; message: string }

export function checkKnowledgeFile(fileName: string, size: number): KbFileCheck {
  const ext = ((fileName || '').split('.').pop() || '').toLowerCase()
  if (!(KB_SUPPORTED_EXTENSIONS as readonly string[]).includes(ext) || !fileName.includes('.')) {
    return { ok: false, message: KB_MSG.badType }
  }
  if (!size) return { ok: false, message: KB_MSG.empty }
  if (size > KB_MAX_FILE_SIZE) return { ok: false, message: KB_MSG.tooLarge }
  return { ok: true, ext }
}
