import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { View, Text } from '@tarojs/components'
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import {
  ensureLogin,
  getKnowledgeDocuments,
  getKnowledgeDocumentStatus,
  uploadKnowledgeDocumentFromPath,
  uploadKnowledgeDocumentFromWebFile,
  deleteKnowledgeDocument,
  getMasteryOverview,
  waitForLogin,
  type KnowledgeDocumentItem,
  type MasteryOverviewResponse,
} from '../../services/api'
import { groupDocumentsToPockets } from '../../services/v2Adapters'
import {
  getBackgroundQuizState,
  startBackgroundQuizGeneration,
  subscribeBackgroundQuiz,
  type BackgroundQuizState,
} from '../../services/backgroundQuizManager'
import FloatingDock from '../../components/FloatingDock'
import BackgroundTaskPill from '../../components/BackgroundTaskPill'
import './index.scss'

const SUPPORTED_EXTENSIONS = ['pdf', 'docx', 'md', 'txt']
const MAX_FILE_SIZE = 10 * 1024 * 1024

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  processing: { label: '切片归类中', cls: 'is-processing' },
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
  const [overview, setOverview] = useState<MasteryOverviewResponse | null>(null)
  const [activeDomain, setActiveDomain] = useState<string>('全部')
  const [uploading, setUploading] = useState(false)
  const [dockVisible, setDockVisible] = useState(true)
  const [bgQuiz, setBgQuiz] = useState<BackgroundQuizState>(() => getBackgroundQuizState())

  useEffect(() => subscribeBackgroundQuiz(setBgQuiz), [])

  const pollTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({})
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const loadDocuments = useCallback(async () => {
    await waitForLogin()
    const [docsRes, masteryRes] = await Promise.all([
      getKnowledgeDocuments().catch(() => null),
      getMasteryOverview(),
    ])
    if (docsRes) setDocuments(docsRes.items)
    if (masteryRes) setOverview(masteryRes)
  }, [])

  useDidShow(() => {
    setDockVisible(true)
    Taro.eventCenter.trigger('zx:tab-change', 'knowledge')
    void loadDocuments()
  })

  useDidHide(() => {
    setDockVisible(false)
  })

  useEffect(() => {
    return () => {
      Object.values(pollTimers.current).forEach((timer) => clearInterval(timer))
    }
  }, [])

  const pockets = useMemo(
    () => groupDocumentsToPockets(documents, overview),
    [documents, overview],
  )

  const filteredDocs = useMemo(() => {
    if (activeDomain === '全部') return documents
    const targetBucket = pockets.find((p) => p.name === activeDomain)
    return targetBucket ? targetBucket.docs : documents
  }, [documents, pockets, activeDomain])

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
                  domain_id: status.domain_id ?? doc.domain_id,
                  domain_name: status.domain_name ?? doc.domain_name,
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

  const prependUploadedDoc = (
    docId: string,
    fileName: string,
    ext: string,
    size: number,
    domainName?: string,
  ) => {
    setDocuments((prev) => [
      {
        doc_id: docId,
        file_name: fileName,
        file_type: ext,
        file_size: size,
        status: 'processing',
        chunk_count: 0,
        domain_name: domainName,
        error_message: null,
        created_at: new Date().toISOString(),
      },
      ...prev,
    ])
    Taro.showToast({ title: '已装入口袋，正在后台切片', icon: 'success' })
    pollDocumentStatus(docId)
  }

  const validateFileMeta = (fileName: string, size: number): string | null => {
    const ext = (fileName.split('.').pop() || '').toLowerCase()
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      Taro.showToast({ title: '仅支持 PDF / Word / Markdown / TXT 文件', icon: 'none' })
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
      prependUploadedDoc(result.doc_id, result.file_name, ext, file.size, result.domain_name)
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
      prependUploadedDoc(result.doc_id, result.file_name, ext, file.size, result.domain_name)
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
      title: '移出知识口袋',
      content: `确定删除《${doc.file_name}》吗？删除后向量切片无法恢复`,
      success: async (res) => {
        if (!res.confirm) return
        try {
          await deleteKnowledgeDocument(doc.doc_id)
          setDocuments((prev) => prev.filter((item) => item.doc_id !== doc.doc_id))
          Taro.showToast({ title: '已移出', icon: 'success' })
        } catch (err: any) {
          Taro.showToast({ title: err?.message || '删除失败', icon: 'none' })
        }
      },
    })
  }

  const handleStartQuiz = (doc: KnowledgeDocumentItem) => {
    if (doc.status !== 'ready') return
    void startBackgroundQuizGeneration({
      user_input: `请基于我的知识库文档《${doc.file_name}》生成一套高质量自适应自测题`,
      question_count: 5,
      adaptive_mode: true,
      doc_id: doc.doc_id,
      doc_ids: [doc.doc_id],
      domain_id: doc.domain_id,
      enable_web_search: true,
      displayTopic: doc.file_name.replace(/\.[^.]+$/, ''),
      initiatedRoute: 'pages/knowledge/index',
    })
  }

  return (
    <View className='knowledge-page'>
      <View className='kb-header'>
        <View>
          <Text className='kb-kicker'>PRIVATE LIBRARY</Text>
          <Text className='kb-title'>你的知识口袋</Text>
        </View>
        <View className='kb-upload-pill zx-press' onClick={handleTriggerUpload}>
          <Text>{uploading ? '上传中...' : '+ 上传文档'}</Text>
        </View>
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

      <View className='kb-summary-strip'>
        <Text className='kb-strip-text'>支持 PDF / Word / MD 自动切片归档</Text>
        <Text className='kb-strip-badge'>已分 {pockets.length} 域</Text>
      </View>

      <View className='pockets-grid'>
        {pockets.map((bucket, idx) => {
          const isSelected = activeDomain === bucket.name
          return (
            <View
              key={bucket.name}
              className={`pocket-card is-${bucket.theme} ${isSelected ? 'is-selected' : ''} zx-press`}
              onClick={() =>
                setActiveDomain((prev) => (prev === bucket.name ? '全部' : bucket.name))
              }
            >
              <View className={`pocket-paper ${idx % 2 === 1 ? 'is-tilt-right' : ''}`}>
                <Text className='paper-title'>{bucket.previewTitle}</Text>
                <Text className='paper-sub'>{bucket.previewSnippet}</Text>
              </View>
              <View className='pocket-lip'>
                <View className='pocket-stitch' />
                <Text className='pocket-name'>{bucket.name}</Text>
                <Text className='pocket-meta'>
                  {bucket.docs.length} 份文档 · 保持 {bucket.retentionPct}%
                </Text>
              </View>
            </View>
          )
        })}
        {pockets.length % 2 === 1 && (
          <View className='pocket-card pocket-ghost zx-press' onClick={handleTriggerUpload}>
            <Text className='pocket-ghost-plus'>+</Text>
            <Text className='pocket-ghost-title'>拓展新领域</Text>
            <Text className='pocket-ghost-sub'>上传新主题资料自动新建口袋</Text>
          </View>
        )}
      </View>

      <View className='docs-head'>
        <Text className='docs-title'>
          {activeDomain === '全部' ? `全部文档 (${documents.length}/10)` : `${activeDomain} (${filteredDocs.length})`}
        </Text>
        {activeDomain !== '全部' && (
          <Text className='docs-reset' onClick={() => setActiveDomain('全部')}>
            查看全部
          </Text>
        )}
      </View>

      {filteredDocs.length === 0 ? (
        <View className='zx-card empty-docs' onClick={handleTriggerUpload}>
          <Text className='empty-docs-text'>暂无资料，点此上传 PDF / Markdown / Word 装入口袋</Text>
        </View>
      ) : (
        <View className='docs-list'>
          {filteredDocs.map((doc) => {
            const st = STATUS_MAP[doc.status] || { label: doc.status, cls: 'is-processing' }
            return (
              <View key={doc.doc_id} className='zx-card doc-row'>
                <View className='doc-ext-pill'>
                  <Text>{doc.file_type.toUpperCase()}</Text>
                </View>

                <View className='doc-info'>
                  <Text className='doc-name'>{doc.file_name}</Text>
                  <Text className='doc-meta'>
                    {formatFileSize(doc.file_size)} · {doc.chunk_count} 片段
                    {doc.domain_name ? ` · ${doc.domain_name}` : ''}
                  </Text>
                  {doc.status === 'failed' && doc.error_message && (
                    <Text className='doc-err'>{doc.error_message}</Text>
                  )}
                </View>

                <View className='doc-actions'>
                  {doc.status === 'ready' ? (
                    <View
                      className='btn-doc-quiz zx-press'
                      onClick={() => handleStartQuiz(doc)}
                    >
                      <Text>{bgQuiz.status === 'running' ? '出题中...' : '出题 →'}</Text>
                    </View>
                  ) : (
                    <View className={`doc-status ${st.cls}`}>
                      <Text>{st.label}</Text>
                    </View>
                  )}
                  <View className='btn-doc-del zx-press' onClick={() => handleDelete(doc)}>
                    <Text>×</Text>
                  </View>
                </View>
              </View>
            )
          })}
        </View>
      )}

      <BackgroundTaskPill visible={dockVisible} />

      {process.env.TARO_ENV === 'h5' && dockVisible && <FloatingDock activeKey='knowledge' />}
    </View>
  )
}
