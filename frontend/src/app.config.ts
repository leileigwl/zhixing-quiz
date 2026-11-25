// V3.0 公开门头页只进 H5（小程序没有门头页，仍由 wx.login 静默登录直达首页）
const H5_ONLY_PAGES = process.env.TARO_ENV === 'h5' ? ['pages/landing/index'] : []

export default defineAppConfig({
  pages: [
    'pages/index/index',
    'pages/knowledge/index',
    'pages/mastery/index',
    'pages/profile/index',
    'pages/quiz/index',
    'pages/report/index',
    'pages/login/index',
    ...H5_ONLY_PAGES,
  ],
  networkTimeout: {
    request: 600000,
    connectSocket: 600000,
    uploadFile: 600000,
    downloadFile: 600000,
  },
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#f6f5f1',
    navigationBarTitleText: '知行快刷',
    navigationBarTextStyle: 'black',
    backgroundColor: '#f6f5f1',
  },
  tabBar: {
    custom: true,
    color: '#8f93a0',
    selectedColor: '#18191e',
    backgroundColor: '#18191e',
    borderStyle: 'black',
    list: [
      {
        pagePath: 'pages/index/index',
        text: '今日',
      },
      {
        pagePath: 'pages/knowledge/index',
        text: '口袋',
      },
      {
        pagePath: 'pages/mastery/index',
        text: '曲线',
      },
      {
        pagePath: 'pages/profile/index',
        text: '我的',
      },
    ],
  },
})
