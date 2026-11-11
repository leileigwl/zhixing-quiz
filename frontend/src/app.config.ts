export default defineAppConfig({
  pages: [
    'pages/index/index',
    'pages/knowledge/index',
    'pages/profile/index',
    'pages/quiz/index',
    'pages/report/index',
  ],
  networkTimeout: {
    request: 600000,
    connectSocket: 600000,
    uploadFile: 600000,
    downloadFile: 600000,
  },
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#ffffff',
    navigationBarTitleText: '知行快刷',
    navigationBarTextStyle: 'black',
    backgroundColor: '#f5f7fb',
  },
  tabBar: {
    color: '#94a3b8',
    selectedColor: '#4f46e5',
    backgroundColor: '#ffffff',
    borderStyle: 'black',
    list: [
      {
        pagePath: 'pages/index/index',
        text: '闯关',
        iconPath: 'assets/tab-quiz.png',
        selectedIconPath: 'assets/tab-quiz-active.png',
      },
      {
        pagePath: 'pages/knowledge/index',
        text: '知识库',
        iconPath: 'assets/tab-kb.png',
        selectedIconPath: 'assets/tab-kb-active.png',
      },
      {
        pagePath: 'pages/profile/index',
        text: '我的',
        iconPath: 'assets/tab-me.png',
        selectedIconPath: 'assets/tab-me-active.png',
      },
    ],
  },
})
