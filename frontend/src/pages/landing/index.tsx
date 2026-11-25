import Taro from '@tarojs/taro'
import { getToken } from '../../services/api'
import { ICP_NUMBER, ICP_URL } from '../../components/IcpFooter'
import { LANDING_FACTS, LANDING_FAQ, LANDING_FEATURES, LANDING_STEPS, type LandingFeature } from './content'
import './index.scss'

/**
 * V3.0 公开门头页（仅 H5，见 app.config.ts）。
 * 未登录访问根路径先到这里（services/authGuard.ts）；已登录访问根路径直接进应用首页，门头页仍可通过 #/pages/landing/index 打开。
 * 版式参考现代 AI/SaaS 官网：眉标 + 大标题 hero + 双按钮、事实条、功能分区、编号流程、示意图、收尾 CTA 色带、简洁页脚。
 * 所有产品画面均为 CSS/SVG 绘制的「界面示意」，不是真实数据。
 */

function goStart() {
  if (getToken()) {
    void Taro.reLaunch({ url: '/pages/index/index' })
    return
  }
  void Taro.navigateTo({ url: '/pages/login/index' })
}

function scrollToId(id: string) {
  if (typeof document === 'undefined') return
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function BrandMark() {
  return (
    <span className='ld-mark' aria-hidden='true'>
      <span className='ld-mark-a' />
      <span className='ld-mark-b' />
      <span className='ld-mark-dot' />
    </span>
  )
}

function FeatureIcon({ k }: { k: LandingFeature['key'] }) {
  const common = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (k === 'ai')
    return (
      <svg {...common} aria-hidden='true'>
        <path d='M12 3l1.8 4.6L18.5 9l-4.7 1.6L12 15l-1.8-4.4L5.5 9l4.7-1.4z' />
        <path d='M18 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z' />
      </svg>
    )
  if (k === 'curve')
    return (
      <svg {...common} aria-hidden='true'>
        <path d='M3 5c3 9 6 12 18 13' />
        <path d='M3 20h18' />
        <circle cx='9' cy='13' r='1.6' />
      </svg>
    )
  if (k === 'pocket')
    return (
      <svg {...common} aria-hidden='true'>
        <path d='M4 6h16v5a8 8 0 0 1-16 0z' />
        <path d='M8 10l4 3 4-3' />
      </svg>
    )
  return (
    <svg {...common} aria-hidden='true'>
      <circle cx='12' cy='12' r='8' />
      <path d='M12 4a8 8 0 0 1 8 8h-8z' fill='currentColor' stroke='none' />
    </svg>
  )
}

/** hero 右侧的产品示意：题卡 + 曲线卡 + 掌握度环（纯示意，不读任何接口） */
function HeroMock() {
  return (
    <div className='ld-mock' aria-label='界面示意'>
      <span className='ld-mock-tag'>界面示意</span>
      <div className='ld-mock-quiz'>
        <div className='ld-mock-quiz-head'>
          <span className='ld-chip is-brand'>计算机网络</span>
          <span className='ld-mock-progress'>2 / 5</span>
        </div>
        <p className='ld-mock-stem'>TCP 四次挥手中，主动关闭方等待 2MSL 的主要目的是？</p>
        <ul className='ld-mock-opts'>
          <li className='is-ok'>
            <b>A</b>确保最后的 ACK 送达，并让旧报文失效
          </li>
          <li>
            <b>B</b>立即释放端口以便快速复用
          </li>
          <li>
            <b>C</b>等待应用层读完缓冲区
          </li>
        </ul>
      </div>
      <div className='ld-mock-row'>
        <div className='ld-mock-curve'>
          <span className='ld-mock-label'>记忆保持率</span>
          <svg viewBox='0 0 200 90' className='ld-curve-svg' aria-hidden='true'>
            <path d='M4 12 C 40 60, 70 76, 196 84' className='ld-curve-base' />
            <path d='M4 12 C 22 34, 34 40, 48 42 L 52 16 C 72 36, 86 42, 104 44 L 108 18 C 134 34, 160 40, 196 42' className='ld-curve-boost' />
          </svg>
          <span className='ld-mock-legend'>
            <i className='is-boost' />按曲线复习 <i className='is-base' />不复习
          </span>
        </div>
        <div className='ld-mock-ring'>
          <div className='ld-ring' style={{ ['--p' as string]: '72' }}>
            <span>72%</span>
          </div>
          <span className='ld-mock-label'>掌握度</span>
        </div>
      </div>
    </div>
  )
}

export default function LandingPage() {
  const year = new Date().getFullYear()
  return (
    <div className='ld-page'>
      <header className='ld-nav'>
        <div className='ld-wrap ld-nav-inner'>
          <a className='ld-brand' href='#/pages/landing/index' aria-label='知行快刷 门头页'>
            <BrandMark />
            <span>知行快刷</span>
          </a>
          <nav className='ld-nav-links' aria-label='页面导航'>
            <button type='button' className='ld-link' onClick={() => scrollToId('ld-features')}>功能</button>
            <button type='button' className='ld-link' onClick={() => scrollToId('ld-steps')}>使用流程</button>
            <button type='button' className='ld-link' onClick={() => scrollToId('ld-curve')}>记忆曲线</button>
          </nav>
          <button type='button' className='ld-btn ld-btn-dark ld-nav-cta' onClick={goStart}>
            登录
          </button>
        </div>
      </header>

      <main>
        <section className='ld-hero'>
          <div className='ld-hero-bg' aria-hidden='true'>
            <span className='ld-blob is-1' />
            <span className='ld-blob is-2' />
            <span className='ld-blob is-3' />
          </div>
          <div className='ld-wrap ld-hero-inner'>
            <div className='ld-hero-copy'>
              <span className='ld-eyebrow'>
                <i />AI 出题 × 遗忘曲线复习
              </span>
              <h1 className='ld-h1'>
                把读过的资料，
                <br />
                练成<em>记得住</em>的知识
              </h1>
              <p className='ld-lead'>
                输入一个主题或上传你的笔记，AI 立刻出一组题；答错的题按遗忘曲线自动安排复习，每个知识域的掌握度一眼看清。
              </p>
              <div className='ld-cta-row'>
                <button type='button' className='ld-btn ld-btn-primary ld-btn-lg' onClick={goStart}>
                  登录 / 开始使用 <span aria-hidden='true'>→</span>
                </button>
                <button type='button' className='ld-btn ld-btn-ghost ld-btn-lg' onClick={() => scrollToId('ld-steps')}>
                  看看怎么用
                </button>
              </div>
              <p className='ld-hero-note'>邮箱验证码登录 · 支持任意邮箱 · 学习记录跨设备同步</p>
            </div>
            <HeroMock />
          </div>
        </section>

        <section className='ld-facts' aria-label='产品能力'>
          <div className='ld-wrap ld-facts-inner'>
            {LANDING_FACTS.map((f) => (
              <div key={f.big} className='ld-fact'>
                <strong>{f.big}</strong>
                <span>{f.small}</span>
              </div>
            ))}
          </div>
        </section>

        <section className='ld-section' id='ld-features'>
          <div className='ld-wrap'>
            <span className='ld-kicker'>核心功能</span>
            <h2 className='ld-h2'>出题、复习、追踪，一条线做完</h2>
            <p className='ld-section-lead'>不用再自己整理错题本，也不用记哪天该复习什么。</p>
            <div className='ld-feature-grid'>
              {LANDING_FEATURES.map((f) => (
                <article key={f.key} className={`ld-feature is-${f.key}`}>
                  <span className='ld-feature-icon'>
                    <FeatureIcon k={f.key} />
                  </span>
                  <h3>{f.title}</h3>
                  <p>{f.desc}</p>
                  <ul>
                    {f.points.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className='ld-section ld-steps-section' id='ld-steps'>
          <div className='ld-wrap'>
            <span className='ld-kicker'>使用流程</span>
            <h2 className='ld-h2'>三步开始</h2>
            <ol className='ld-steps'>
              {LANDING_STEPS.map((s) => (
                <li key={s.no} className='ld-step'>
                  <span className='ld-step-no'>{s.no}</span>
                  <h3>{s.title}</h3>
                  <p>{s.desc}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className='ld-section' id='ld-curve'>
          <div className='ld-wrap ld-curve-split'>
            <div>
              <span className='ld-kicker'>为什么按曲线复习</span>
              <h2 className='ld-h2'>在快忘的时候再练一次</h2>
              <p className='ld-section-lead'>
                学过的内容会随时间遗忘。每次在保持率下降到阈值前复习一次，下一次遗忘就会更慢。知行快刷按你每道题的作答结果，用 SM-2 算法排好下一次复习的日子。
              </p>
              <ul className='ld-checks'>
                <li>答对：复习间隔拉长</li>
                <li>答错：题目回到今日待巩固</li>
                <li>保持率跌破阈值：排进重点攻坚</li>
              </ul>
            </div>
            <figure className='ld-curve-card'>
              <span className='ld-mock-tag'>示意</span>
              <svg viewBox='0 0 320 180' className='ld-curve-big' role='img' aria-label='复习与不复习的保持率对比示意'>
                <line x1='24' y1='150' x2='312' y2='150' className='ld-axis' />
                <line x1='24' y1='16' x2='24' y2='150' className='ld-axis' />
                <path d='M24 24 C 80 110, 140 136, 312 146' className='ld-curve-base' />
                <path d='M24 24 C 46 60, 60 70, 84 74 L 90 30 C 120 62, 140 70, 168 72 L 174 34 C 214 54, 250 60, 312 62' className='ld-curve-boost' />
                <circle cx='90' cy='30' r='4' className='ld-dot' />
                <circle cx='174' cy='34' r='4' className='ld-dot' />
              </svg>
              <figcaption>
                <span><i className='is-boost' />按曲线复习</span>
                <span><i className='is-base' />不复习</span>
              </figcaption>
            </figure>
          </div>
        </section>

        <section className='ld-section ld-faq-section'>
          <div className='ld-wrap'>
            <h2 className='ld-h2 is-center'>常见问题</h2>
            <div className='ld-faq'>
              {LANDING_FAQ.map((f) => (
                <details key={f.q} className='ld-faq-item'>
                  <summary>{f.q}</summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className='ld-final'>
          <div className='ld-wrap ld-final-inner'>
            <h2>今天就出第一组题</h2>
            <p>把一份笔记变成一组能反复练、会按时回来找你的题。</p>
            <button type='button' className='ld-btn ld-btn-light ld-btn-lg' onClick={goStart}>
              登录 / 开始使用 <span aria-hidden='true'>→</span>
            </button>
          </div>
        </section>
      </main>

      <footer className='ld-footer'>
        <div className='ld-wrap ld-footer-inner'>
          <div className='ld-footer-brand'>
            <span className='ld-brand'>
              <BrandMark />
              <span>知行快刷</span>
            </span>
            <p>AI 出题 × 遗忘曲线复习</p>
          </div>
          <div className='ld-footer-links'>
            <button type='button' className='ld-link' onClick={goStart}>登录</button>
            <button type='button' className='ld-link' onClick={() => scrollToId('ld-features')}>功能</button>
            <button type='button' className='ld-link' onClick={() => scrollToId('ld-steps')}>使用流程</button>
          </div>
        </div>
        <div className='ld-wrap ld-footer-bottom'>
          <span>© {year} 知行快刷</span>
          <a className='ld-icp' href={ICP_URL} target='_blank' rel='noopener noreferrer'>
            {ICP_NUMBER}
          </a>
        </div>
      </footer>
    </div>
  )
}
