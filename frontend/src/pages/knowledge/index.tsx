import { useState, useRef, useCallback, useEffect } from 'react'
import { View, Text } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import {
  ensureLogin,
  getKnowledgeDocuments,
  getKnowledgeDocumentStatus,
  uploadKnowledgeDocumentFromPath,
  uploadKnowledgeDocumentFromWebFile,
  deleteKnowledgeDocument,
  generateQuizAsync,
  pollQuizTask,
  waitForLogin,
} from '../../services/api'
import type { KnowledgeDocumentItem } from '../../services/api'
import { setActiveQuizSession } from '../../services/quizSessionStore'
import './index.scss'

const SUPPORTED_EXTENSIONS = ['pdf', 'docx', 'md', 'txt']
const MAX_FILE_SIZE = 10 * 1024 * 1024

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  processing: { label: '解析中...', cls: 'is-processing' },
  ready: { label: '已就绪', cls: 'is-ready' },
  failed: { label: '解析失败', cls: 'is-failed' },
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function KnowledgePage() {
  const [documents, setDocuments] = useState<KnowledgeDocumentItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [generatingDocId, setGeneratingDocId] = useState<string | null>(null)
  const [generatingText, setGeneratingText] = useState('正在创建出题任务...')

  const pollTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({})
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const loadDocuments = useCallback(async () => {
    await waitForLogin()
    try {
      const res = await getKnowledgeDocuments()
      setDocuments(res.items)
    } catch {
      // ignore silent refresh errors
    }
  }, [])

  useDidShow(() => {
    void loadDocuments()
  })

  useEffect(() => {
    return () => {
      Object.values(pollTimers.current).forEach((timer) => clearInterval(timer))
    }
  }, [])

  const pollDocumentStatus = useCallback((docId: string) => {
    if (pollTimers.current[docId]) {
      clearInterval(pollTimers.current[docId])
    }
    let attempts = 0
    const timer = setInterval(async () => {
      attempts++
      try {
        const status = await getKnowledgeDocumentStatus(docId)
        setDocuments((prev) =>
          prev.map((doc) =>
            doc.doc_id === docId
              ? {
                  ...doc,
                  status: status.status,
                  chunk_count: status.chunk_count,
                  error_message: status.error_message,
                }
              : doc,
          ),
        )
        if (status.status === 'ready' || status.status === 'failed' || attempts >= 40) {
          clearInterval(timer)
          delete pollTimers.current[docId]
        }
      } catch {
        clearInterval(timer)
        delete pollTimers.current[docId]
      }
    }, 3000)
    pollTimers.current[docId] = timer
  }, [])

  const prependUploadedDoc = (docId: string, fileName: string, ext: string, size: number) => {
    setDocuments((prev) => [
      {
        doc_id: docId,
        file_name: fileName,
        file_type: ext,
        file_size: size,
        status: 'processing',
        chunk_count: 0,
        error_message: null,
        created_at: new Date().toISOString(),
      },
      ...prev,
    ])
    Taro.showToast({ title: '上传成功，正在后台解析', icon: 'success' })
    pollDocumentStatus(docId)
  }

  const validateFileMeta = (fileName: string, size: number): string | null => {
    const ext = (fileName.split('.').pop() || '').toLowerCase()
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      Taro.showToast({ title: '仅支持 PDF/Word/Markdown/TXT 文件', icon: 'none' })
      return null
    }
    if (size === 0) {
      Taro.showToast({ title: '文件内容不能为空', icon: 'none' })
      return null
    }
    if (size > MAX_FILE_SIZE) {
      Taro.showToast({ title: '文件大小不能超过 10MB', icon: 'none' })
      return null
    }
    return ext
  }

  const handleWeappUpload = async () => {
    if (uploading) return
    try {
      const authed = await ensureLogin()
      if (!authed) {
        Taro.showToast({ title: '登录尚未就绪，请稍后再试', icon: 'none' })
        return
      }
      const chooseRes = await Taro.chooseMessageFile({
        count: 1,
        type: 'file',
        extension: SUPPORTED_EXTENSIONS,
      })
      const file = chooseRes.tempFiles?.[0]
      if (!file) return

      const ext = validateFileMeta(file.name, file.size)
      if (!ext) return

      setUploading(true)
      const result = await uploadKnowledgeDocumentFromPath(file.path, file.name)
      prependUploadedDoc(result.doc_id, result.file_name, ext, file.size)
    } catch (err: any) {
      if (err?.errMsg?.includes('cancel')) return
      Taro.showToast({ title: err?.message || '上传失败，请稍后重试', icon: 'none' })
    } finally {
      setUploading(false)
    }
  }

  const handleH5FileChange = async (e: any) => {
    const file: File | undefined = e?.target?.files?.[0]
    if (e?.target) e.target.value = ''
    if (!file || uploading) return

    const ext = validateFileMeta(file.name, file.size)
    if (!ext) return

    setUploading(true)
    try {
      const authed = await ensureLogin()
      if (!authed) {
        Taro.showToast({ title: '开发环境登录未成功，请确认后端已启动', icon: 'none' })
        return
      }
      const result = await uploadKnowledgeDocumentFromWebFile(file)
      prependUploadedDoc(result.doc_id, result.file_name, ext, file.size)
    } catch (err: any) {
      Taro.showToast({ title: err?.message || '上传失败，请稍后重试', icon: 'none' })
    } finally {
      setUploading(false)
    }
  }

  const handleTriggerUpload = () => {
    if (process.env.TARO_ENV === 'h5') {
      fileInputRef.current?.click()
      return
    }
    void handleWeappUpload()
  }

  const handleDelete = (doc: KnowledgeDocumentItem) => {
    Taro.showModal({
      title: '删除文档',
      content: `确定删除《${doc.file_name}》吗？删除后知识库内容将无法恢复`,
      success: async (res) => {
        if (!res.confirm) return
        try {
          await deleteKnowledgeDocument(doc.doc_id)
          setDocuments((prev) => prev.filter((item) => item.doc_id !== doc.doc_id))
          Taro.showToast({ title: '已删除', icon: 'success' })
        } catch (err: any) {
          Taro.showToast({ title: err?.message || '删除失败', icon: 'none' })
        }
      },
    })
  }

  const handleStartQuiz = async (doc: KnowledgeDocumentItem) => {
    if (doc.status !== 'ready' || generatingDocId) return

    setGeneratingDocId(doc.doc_id)
    setGeneratingText('正在创建出题任务...')
    try {
      const userInput = `请基于我上传的知识库文档《${doc.file_name}》生成一套闯关题`
      const { task_id } = await generateQuizAsync(userInput, 5, doc.doc_id, false)

      setGeneratingText('AI 正在检索知识库片段并生成题目...')
      const quizData = await pollQuizTask(task_id, (status, task) => {
        if (task?.stage_message) {
          setGeneratingText(task.stage_message)
        } else if (status === 'running') {
          setGeneratingText('AI 正在编排题目与解析，请稍候...')
        }
      })

      setActiveQuizSession(quizData, [])
      Taro.navigateTo({
        url: `/pages/quiz/index?quizId=${encodeURIComponent(quizData.quiz_id)}`,
      })
    } catch (err: any) {
      Taro.showToast({ title: err?.message || '生成失败，请稍后重试', icon: 'none' })
    } finally {
      setGeneratingDocId(null)
      setGeneratingText('正在创建出题任务...')
    }
  }

  return (
    <View className='knowledge-page'>
      <Text className='page-h1'>私有知识库</Text>

      {/* 上传规范提示条 */}
      <View className='kb-notice'>
        <View>
          <Text className='kb-notice-title'>支持 PDF / Word / MD / TXT</Text>
          <Text className='kb-notice-sub'>单文件 ≤ 10MB · 最多 10 篇</Text>
        </View>
        <Text className='kb-notice-icon'>ⓘ</Text>
      </View>

      {/* 上传区域（兼容小程序选文件与 H5 原生选择） */}
      <View className='upload-box' onClick={handleTriggerUpload}>
        <Text className='upload-icon'>☁</Text>
        <Text className='upload-title'>{uploading ? '正在上传...' : '点击上传学习资料'}</Text>
        <Text className='upload-sub'>
          {process.env.TARO_ENV === 'h5' ? '支持从本地选取文档' : '支持从微信聊天或本地选择文件'}
        </Text>
      </View>

      {process.env.TARO_ENV === 'h5' && (
        <input
          ref={fileInputRef}
          type='file'
          accept='.pdf,.docx,.md,.txt'
          style={{ display: 'none' }}
          onChange={handleH5FileChange}
        />
      )}

      {/* 文档列表 */}
      <View className='list-head'>
        <Text className='list-title'>我的文档 ({documents.length}/10)</Text>
      </View>

      {documents.length === 0 ? (
        <View className='zx-card empty-docs'>
          <Text className='empty-docs-text'>还没有上传资料，上传笔记后即可针对指定文档智能出题</Text>
        </View>
      ) : (
        documents.map((doc) => {
          const st = STATUS_MAP[doc.status] || { label: doc.status, cls: 'is-processing' }
          const extCls = doc.file_type === 'pdf' ? 'is-pdf' : doc.file_type === 'docx' ? 'is-docx' : 'is-md'
          return (
            <View key={doc.doc_id} className='zx-card doc-card'>
              <View className={`file-badge ${extCls}`}>
                <Text>{doc.file_type.toUpperCase()}</Text>
              </View>
              <View className='doc-body'>
                <Text className='doc-name'>{doc.file_name}</Text>
                <Text className='doc-meta'>
                  {formatFileSize(doc.file_size)} · {doc.chunk_count} 片段
                </Text>
                {doc.status === 'failed' && doc.error_message && (
                  <Text className='doc-error'>{doc.error_message}</Text>
                )}
                <View className='doc-footer'>
                  <View className={`status-pill ${st.cls}`}>
                    <Text>● {st.label}</Text>
                  </View>
                  <View className='doc-actions'>
                    {doc.status === 'ready' && (
                      <View
                        className='btn-mini-primary'
                        onClick={() => handleStartQuiz(doc)}
                      >
                        <Text>开始闯关 ›</Text>
                      </View>
                    )}
                    <View className='btn-del' onClick={() => handleDelete(doc)}>
                      <Text>🗑</Text>
                    </View>
                  </View>
                </View>
              </View>
            </View>
          )
        })
      )}

      {generatingDocId && (
        <View className='loading-overlay'>
          <View className='loading-modal'>
            <View className='loading-spinner' />
            <Text className='loading-title'>AI 正在阅读文档出题</Text>
            <Text className='loading-sub'>{generatingText}</Text>
          </View>
        </View>
      )}
    </View>
  )
}
