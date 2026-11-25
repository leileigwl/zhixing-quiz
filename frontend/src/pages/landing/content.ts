/** V3.0 门头页文案与结构数据（纯数据，便于单测与改文案；不含任何虚构的用户量 / 评分） */
export interface LandingFeature {
  key: 'ai' | 'curve' | 'pocket' | 'mastery'
  title: string
  desc: string
  points: string[]
}

export const LANDING_FEATURES: LandingFeature[] = [
  {
    key: 'ai',
    title: 'AI 出题',
    desc: '输入一个主题，或选中自己的笔记、文档，AI 出一组单选 / 多选 / 判断题。',
    points: ['快测 3 题或按掌握度智能推荐题量', '可开智能搜索补充最新资料', '每题带解析与知识点'],
  },
  {
    key: 'curve',
    title: '遗忘曲线复习',
    desc: '答错的题自动进入复习队列，按 SM-2 间隔重复算法安排下次复习时间。',
    points: ['今日待巩固一键秒开', '答对拉长间隔，答错缩短', '保持率跌破阈值时提醒'],
  },
  {
    key: 'pocket',
    title: '知识口袋',
    desc: '上传 PDF、Word、Markdown、TXT，或直接粘贴笔记，按知识域自动归进口袋。',
    points: ['解析完成后可直接选用出题', '同一口袋的题与曲线放在一起', '资料只对自己可见'],
  },
  {
    key: 'mastery',
    title: '掌握度',
    desc: '每个知识域的掌握度、保持率和难度分布一眼看清，知道下一步该练什么。',
    points: ['整体保持率与记忆曲线', '本周完成题数与打卡', '薄弱域自动排进重点攻坚'],
  },
]

export const LANDING_STEPS = [
  { no: '01', title: '放入资料或写一个主题', desc: '上传文档、粘贴笔记，或者只写「TCP 四次挥手」。' },
  { no: '02', title: '出一组题，马上作答', desc: 'AI 按你的熟悉度出题，答完即时看解析和薄弱点。' },
  { no: '03', title: '按曲线复习，看掌握度涨', desc: '错题按遗忘曲线回来找你，掌握度和保持率随练随更。' },
]

/** 事实条：只写产品能力，不写任何统计数字 */
export const LANDING_FACTS = [
  { big: '3 题起', small: '快测或智能推荐题量' },
  { big: 'SM-2', small: '间隔重复复习算法' },
  { big: '4 种格式', small: 'PDF / Word / MD / TXT' },
  { big: '3 端同步', small: '手机 · iPad · 电脑' },
]

export const LANDING_FAQ = [
  { q: '需要安装吗？', a: '不用。浏览器直接打开，手机、iPad、电脑都能用，用邮箱验证码登录。' },
  { q: '我的资料会给别人看吗？', a: '不会。上传的文档和答题记录只属于你的账号。' },
  { q: '支持哪些邮箱？', a: '任意邮箱都可以：QQ、163、Gmail、Outlook、学校或企业邮箱。' },
]
