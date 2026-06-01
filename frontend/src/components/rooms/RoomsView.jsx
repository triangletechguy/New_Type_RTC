import { useEffect, useMemo, useState } from 'react'
import { avatarForIndex, brandAssets, coverForDemoTone, coverForRoomType, roomAssets } from '../../assets/rtc/catalog'
import { ProfilePanel } from '../profile/ProfilePanel'
import { apiRequest } from '../../services/api'
import { canUseAdminDashboard } from '../../utils/roles'
import {
  buildRoomsPath,
  defaultRoomForm,
  defaultRtcModeForRoom,
  getRoomMeta,
  normalizeRtcMode,
  privacyFilterOptions,
  roomFeatureOptions,
  roomFormPayload,
  roomFilterOptions,
  roomPrivacyOptions,
  roomSortOptions,
  roomSupportsVideo,
  roomTypeLabels,
  rtcModeOptions,
  themeOptions,
  validateRoomForm,
} from '../../utils/roomConfig'
import { giftCatalog } from '../../utils/gifts'

const feedTabs = [
  { value: 'following', label: 'Following', filter: 'all' },
  { value: 'for_you', label: 'For You', filter: 'all' },
  { value: 'explore', label: 'Explore', filter: 'all' },
  { value: 'party', label: 'Party', filter: 'pk' },
  { value: 'nearby', label: 'Nearby', filter: 'all' },
  { value: 'latest', label: 'Latest', filter: 'all', sort: 'newest' },
  { value: 'global', label: 'Global', filter: 'all' },
]

const exploreFilters = [
  { value: 'all', label: 'All', filter: 'all' },
  { value: 'new_host', label: 'New Host', filter: 'live' },
  { value: 'games', label: 'Games', filter: 'video' },
  { value: 'pk', label: 'PK', filter: 'pk' },
]

const demoCards = [
  { id: 'demo-1', title: 'Creator Studio Warm-up', host: 'Maya Studio', viewers: 5631, tone: 'aurora', country: 'United States', size: 'feature', badge: 'Group Video', roomType: 'group_video', avatarIndex: 0 },
  { id: 'demo-2', title: 'Open Mic Lounge', host: 'Luna Waves', viewers: 6018, tone: 'warm', category: 'Music', badge: 'Music', roomType: 'audio', avatarIndex: 1 },
  { id: 'demo-3', title: 'Daily Product Standup', host: 'Nora Labs', viewers: 1794, tone: 'rose', category: 'Video', roomType: 'video', avatarIndex: 2 },
  { id: 'demo-4', title: 'Design Review Live', host: 'Pixel Team', viewers: 6186, tone: 'sunset', roomType: 'group_video', avatarIndex: 3 },
  { id: 'demo-5', title: 'Creator Office Hours', host: 'TalkEachOther', viewers: 1090, tone: 'slate', roomType: 'solo_live', avatarIndex: 4 },
  { id: 'demo-6', title: 'Acoustic Session', host: 'Matt M.', viewers: 589, tone: 'amber', roomType: 'group_audio', avatarIndex: 5 },
  { id: 'demo-7', title: 'Night Studio', host: 'Natalie', viewers: 5689, tone: 'night', roomType: 'video', avatarIndex: 6 },
  { id: 'demo-8', title: 'Global Music Room', host: 'Lyss', viewers: 1418, tone: 'plum', country: 'Canada', roomType: 'audio', avatarIndex: 7 },
  { id: 'demo-9', title: 'Supporter Lounge', host: 'Community Ops', viewers: 2032, tone: 'copper', badge: 'Gifts', roomType: 'group_audio', avatarIndex: 1 },
  { id: 'demo-10', title: 'Morning Sync', host: 'Sarah', viewers: 7489, tone: 'cloud', roomType: 'group_video', avatarIndex: 2 },
  { id: 'demo-11', title: 'Private Client Demo', host: 'Enterprise Desk', viewers: 1853, tone: 'wine', privacy: 'private', badge: 'Private', roomType: 'video', avatarIndex: 3 },
  { id: 'demo-12', title: 'Password Beta Room', host: 'QA Studio', viewers: 928, tone: 'silver', privacy: 'password', badge: 'Locked', roomType: 'video', avatarIndex: 4 },
  { id: 'demo-13', title: 'Fresh Creator Drop', host: 'Winnie', viewers: 208, tone: 'olive', tab: 'latest', roomType: 'solo_live', avatarIndex: 5 },
  { id: 'demo-14', title: 'New Host Practice', host: 'Seyi', viewers: 84, tone: 'taupe', tab: 'latest', roomType: 'video', avatarIndex: 6 },
  { id: 'demo-15', title: 'Audio Check Room', host: 'Engineering', viewers: 77, tone: 'mono', tab: 'latest', roomType: 'audio', avatarIndex: 7 },
  { id: 'demo-16', title: 'First Stream Setup', host: 'Vee Studio', viewers: 136, tone: 'rose', tab: 'latest', roomType: 'solo_live', avatarIndex: 0 },
  { id: 'demo-17', title: 'Nearby Creators', host: 'John F.', viewers: 527, tone: 'earth', tab: 'nearby', roomType: 'group_video', avatarIndex: 1 },
  { id: 'demo-18', title: 'Community Check-in', host: 'Art Room', viewers: 181, tone: 'mid', tab: 'nearby', roomType: 'group_audio', avatarIndex: 2 },
  { id: 'demo-19', title: 'Moderator Training', host: 'Ocean Ops', viewers: 57, tone: 'violet', tab: 'nearby', roomType: 'video', avatarIndex: 3 },
  { id: 'demo-20', title: 'Local Music Circle', host: 'ChiChi', viewers: 1238, tone: 'pink', tab: 'nearby', roomType: 'audio', avatarIndex: 4 },
  { id: 'demo-21', title: 'Game Night Voice', host: 'Paniax Gaming', viewers: 299, tone: 'game', tab: 'explore', explore: 'games', roomType: 'group_video', avatarIndex: 5 },
  { id: 'demo-22', title: 'Watch Party Studio', host: 'Cleo', viewers: 1230, tone: 'sand', tab: 'explore', explore: 'games', roomType: 'group_video', avatarIndex: 6 },
  { id: 'demo-23', title: 'Film Room Live', host: 'Prime Stage', viewers: 68279, tone: 'ocean', tab: 'explore', explore: 'games', roomType: 'video', avatarIndex: 7 },
  { id: 'demo-24', title: 'PK Creator Battle', host: 'United States', viewers: 865, tone: 'sky', tab: 'party', party: true, roomType: 'pk_live', avatarIndex: 0 },
  { id: 'demo-25', title: 'Community Party', host: 'Stage Hosts', viewers: 5133, tone: 'storm', tab: 'party', party: true, roomType: 'group_video', avatarIndex: 1 },
  { id: 'demo-26', title: 'Cozy Streamer Night', host: 'The Cozy Studio', viewers: 244, tone: 'ember', tab: 'party', party: true, roomType: 'solo_live', avatarIndex: 2 },
  { id: 'demo-27', title: 'Community Guidelines Preview', host: 'Trust and Safety', viewers: 6345, tone: 'sensitive', sensitive: true, privacy: 'private', roomType: 'video', avatarIndex: 3 },
]

const dmThreads = [
  { id: 'donna', peerId: 32165333, name: 'Donna Walk3...', time: 'Wednesday 19:24', preview: 'Hi, are you joining the live room today?', unread: 1, followed: false },
  { id: 'jennifer', peerId: 32165334, name: 'Jennifer Ortiz...', time: 'Wednesday 17:35', preview: 'Can you check the room invite I sent?', unread: 1, followed: false },
  { id: 'friend', peerId: 32165335, name: 'Friend...', time: 'Wednesday 01:27', preview: 'Following up on the private room link.', unread: 4, followed: true },
  { id: 'buzz', peerId: 32165336, name: 'TalkEachOther', time: 'Wednesday 01:27', preview: 'Welcome to the TalkEachOther lobby.', unread: 1, followed: true },
]

const initialDmMessages = {
  donna: [{ id: 'donna-1', author: 'Donna Walk3...', body: 'Hi, are you joining the live room today?', mine: false }],
  jennifer: [{ id: 'jennifer-1', author: 'Jennifer Ortiz...', body: 'Can you check the room invite I sent?', mine: false }],
  friend: [
    { id: 'friend-1', author: 'Friend...', body: 'Following up on the private room link.', mine: false },
    { id: 'friend-2', author: 'You', body: 'Yes, send it again and I will join.', mine: true },
  ],
  buzz: [{ id: 'welcome', author: 'TalkEachOther', body: 'Welcome to the TalkEachOther lobby.', mine: false }],
}

const settingsNav = [
  { value: 'account', labelKey: 'Account Security', icon: 'U' },
  { value: 'privacy', labelKey: 'Privacy Settings', icon: 'S' },
  { value: 'content', labelKey: 'Content Preferences', icon: 'F' },
  { value: 'region', labelKey: 'Region', icon: 'P' },
  { value: 'terms', labelKey: 'Terms and Policies', icon: 'D' },
]

const languages = ['English', 'Japanese', 'Korean', 'French', 'Italian', 'Russian', 'Spanish', 'German', 'Portuguese', 'Hindi']
const languageLocales = {
  English: 'en',
  Japanese: 'ja',
  Korean: 'ko',
  French: 'fr',
  Italian: 'it',
  Russian: 'ru',
  Spanish: 'es',
  German: 'de',
  Portuguese: 'pt',
  Hindi: 'hi',
}
const languageNativeNames = {
  English: 'English',
  Japanese: '日本語',
  Korean: '한국어',
  French: 'Français',
  Italian: 'Italiano',
  Russian: 'Русский',
  Spanish: 'Español',
  German: 'Deutsch',
  Portuguese: 'Português',
  Hindi: 'हिन्दी',
}
const settingsCopy = {
  English: {
    'Account Security': 'Account Security',
    'Privacy Settings': 'Privacy Settings',
    'Content Preferences': 'Content Preferences',
    'Multi-Language': 'Multi-Language',
    Region: 'Region',
    'Terms and Policies': 'Terms and Policies',
    'Changes are applied immediately for this session.': 'Changes are applied immediately for this session.',
    'Binding cell phone': 'Binding cell phone',
    'Recommended for account recovery and high-value payments.': 'Recommended for account recovery and high-value payments.',
    'Binding email': 'Binding email',
    'Used for login recovery and security notices.': 'Used for login recovery and security notices.',
    'Set login password': 'Set login password',
    'Protect this account when signing in on a new device.': 'Protect this account when signing in on a new device.',
    'Set payment password': 'Set payment password',
    'Add a second check before diamond purchases.': 'Add a second check before diamond purchases.',
    'Devices Logged In': 'Devices Logged In',
    'Show alerts when a new device logs in.': 'Show alerts when a new device logs in.',
    Bound: 'Bound',
    Set: 'Set',
    'Bind cell phone': 'Bind cell phone',
    'Bind email': 'Bind email',
    'Set password': 'Set password',
    'Alerts on': 'Alerts on',
    'Alerts off': 'Alerts off',
    'Cell phone bound.': 'Cell phone bound.',
    'Email bound.': 'Email bound.',
    'Login password set.': 'Login password set.',
    'Payment password set.': 'Payment password set.',
    'Device login alerts updated.': 'Device login alerts updated.',
    Cancel: 'Cancel',
    Save: 'Save',
    'Cell phone number': 'Cell phone number',
    'Email address': 'Email address',
    'New password': 'New password',
    'Confirm password': 'Confirm password',
    'Payment PIN': 'Payment PIN',
    'Confirm PIN': 'Confirm PIN',
    'Enter a valid phone number.': 'Enter a valid phone number.',
    'Enter a valid email address.': 'Enter a valid email address.',
    'Use at least 10 characters for the password.': 'Use at least 10 characters for the password.',
    'Passwords do not match.': 'Passwords do not match.',
    'Use a 6 digit payment PIN.': 'Use a 6 digit payment PIN.',
    'Payment PINs do not match.': 'Payment PINs do not match.',
    'Who can send me a message': 'Who can send me a message',
    'Controls the personal inbox and room chat shortcuts.': 'Controls the personal inbox and room chat shortcuts.',
    Everyone: 'Everyone',
    'Followers only': 'Followers only',
    Nobody: 'Nobody',
    'Private live invitation': 'Private live invitation',
    'Allow hosts to invite you into private live rooms.': 'Allow hosts to invite you into private live rooms.',
    'Automatic deduction for entering the private live broadcast room': 'Automatic deduction for entering the private live broadcast room',
    'After opening, private rooms can automatically deduct diamonds.': 'After opening, private rooms can automatically deduct diamonds.',
    Blacklist: 'Blacklist',
    'Blocked users are controlled from the chat user menu.': 'Blocked users are controlled from the chat user menu.',
    'Live broadcast you are not interested in': 'Live broadcast you are not interested in',
    'Filtered from your feed.': 'Filtered from your feed.',
    'Visible in your feed.': 'Visible in your feed.',
    Filtered: 'Filtered',
    Show: 'Show',
    'Message privacy updated.': 'Message privacy updated.',
    'Private live invitation setting updated.': 'Private live invitation setting updated.',
    'Private-room deduction setting updated.': 'Private-room deduction setting updated.',
    'Live preference updated.': 'Live preference updated.',
    'Restricted Mode': 'Restricted Mode',
    'Hide potentially sensitive content.': 'Hide potentially sensitive content.',
    'Warning Mode': 'Warning Mode',
    'Show a warning before sensitive rooms open.': 'Show a warning before sensitive rooms open.',
    'All Modes': 'All Modes',
    'Show all room content that is available to your account.': 'Show all room content that is available to your account.',
    'selected.': 'selected.',
    'Language changed to {language}.': 'Language changed to {language}.',
    'Search region': 'Search region',
    'Region changed to {region}.': 'Region changed to {region}.',
    'Terms of Service': 'Terms of Service',
    'Privacy Policy': 'Privacy Policy',
    'Child Safety Policy': 'Child Safety Policy',
    'Anti-Bullying Policy': 'Anti-Bullying Policy',
    Copyright: 'Copyright',
    '{policy} will open in the production policy page.': '{policy} will open in the production policy page.',
  },
  Japanese: {
    'Account Security': 'アカウントセキュリティ',
    'Privacy Settings': 'プライバシー設定',
    'Content Preferences': 'コンテンツ設定',
    'Multi-Language': '多言語',
    Region: '地域',
    'Terms and Policies': '利用規約とポリシー',
    'Changes are applied immediately for this session.': '変更はこのセッションにすぐ反映されます。',
    'Binding cell phone': '携帯電話を連携',
    'Recommended for account recovery and high-value payments.': 'アカウント復旧と高額決済におすすめです。',
    'Binding email': 'メールを連携',
    'Used for login recovery and security notices.': 'ログイン復旧とセキュリティ通知に使用します。',
    'Set login password': 'ログインパスワードを設定',
    'Protect this account when signing in on a new device.': '新しい端末でサインインするときに保護します。',
    'Set payment password': '支払いパスワードを設定',
    'Add a second check before diamond purchases.': 'ダイヤ購入前に追加確認します。',
    'Devices Logged In': 'ログイン中の端末',
    'Show alerts when a new device logs in.': '新しい端末のログイン時に通知します。',
    Bound: '連携済み',
    Set: '設定済み',
    'Bind cell phone': '携帯電話を連携',
    'Bind email': 'メールを連携',
    'Set password': 'パスワード設定',
    'Alerts on': '通知オン',
    'Alerts off': '通知オフ',
    'Cell phone bound.': '携帯電話を連携しました。',
    'Email bound.': 'メールを連携しました。',
    'Login password set.': 'ログインパスワードを設定しました。',
    'Payment password set.': '支払いパスワードを設定しました。',
    'Device login alerts updated.': '端末ログイン通知を更新しました。',
    Cancel: 'キャンセル',
    Save: '保存',
    'Cell phone number': '携帯電話番号',
    'Email address': 'メールアドレス',
    'New password': '新しいパスワード',
    'Confirm password': 'パスワード確認',
    'Payment PIN': '支払いPIN',
    'Confirm PIN': 'PIN確認',
    'Enter a valid phone number.': '有効な電話番号を入力してください。',
    'Enter a valid email address.': '有効なメールアドレスを入力してください。',
    'Use at least 10 characters for the password.': 'パスワードは10文字以上にしてください。',
    'Passwords do not match.': 'パスワードが一致しません。',
    'Use a 6 digit payment PIN.': '6桁の支払いPINを使用してください。',
    'Payment PINs do not match.': '支払いPINが一致しません。',
    'Language changed to {language}.': '言語を{language}に変更しました。',
  },
  Korean: {
    'Account Security': '계정 보안',
    'Privacy Settings': '개인정보 설정',
    'Content Preferences': '콘텐츠 설정',
    'Multi-Language': '다국어',
    Region: '지역',
    'Terms and Policies': '약관 및 정책',
    'Changes are applied immediately for this session.': '변경 사항은 이 세션에 즉시 적용됩니다.',
    'Binding cell phone': '휴대폰 연결',
    'Recommended for account recovery and high-value payments.': '계정 복구와 고액 결제에 권장됩니다.',
    'Binding email': '이메일 연결',
    'Used for login recovery and security notices.': '로그인 복구와 보안 알림에 사용됩니다.',
    'Set login password': '로그인 비밀번호 설정',
    'Protect this account when signing in on a new device.': '새 기기 로그인 시 계정을 보호합니다.',
    'Set payment password': '결제 비밀번호 설정',
    'Add a second check before diamond purchases.': '다이아몬드 구매 전에 추가 확인을 합니다.',
    'Devices Logged In': '로그인된 기기',
    'Show alerts when a new device logs in.': '새 기기 로그인 시 알림을 표시합니다.',
    Bound: '연결됨',
    Set: '설정됨',
    'Bind cell phone': '휴대폰 연결',
    'Bind email': '이메일 연결',
    'Set password': '비밀번호 설정',
    'Alerts on': '알림 켜짐',
    'Alerts off': '알림 꺼짐',
    'Cell phone bound.': '휴대폰이 연결되었습니다.',
    'Email bound.': '이메일이 연결되었습니다.',
    'Login password set.': '로그인 비밀번호가 설정되었습니다.',
    'Payment password set.': '결제 비밀번호가 설정되었습니다.',
    'Device login alerts updated.': '기기 로그인 알림이 업데이트되었습니다.',
    Cancel: '취소',
    Save: '저장',
    'Cell phone number': '휴대폰 번호',
    'Email address': '이메일 주소',
    'New password': '새 비밀번호',
    'Confirm password': '비밀번호 확인',
    'Payment PIN': '결제 PIN',
    'Confirm PIN': 'PIN 확인',
    'Enter a valid phone number.': '올바른 전화번호를 입력하세요.',
    'Enter a valid email address.': '올바른 이메일 주소를 입력하세요.',
    'Use at least 10 characters for the password.': '비밀번호는 10자 이상이어야 합니다.',
    'Passwords do not match.': '비밀번호가 일치하지 않습니다.',
    'Use a 6 digit payment PIN.': '6자리 결제 PIN을 사용하세요.',
    'Payment PINs do not match.': '결제 PIN이 일치하지 않습니다.',
    'Who can send me a message': '나에게 메시지를 보낼 수 있는 사람',
    'Controls the personal inbox and room chat shortcuts.': '개인 받은편지함과 방 채팅 바로가기를 제어합니다.',
    Everyone: '모두',
    'Followers only': '팔로워만',
    Nobody: '아무도 없음',
    'Private live invitation': '비공개 라이브 초대',
    'Allow hosts to invite you into private live rooms.': '호스트가 비공개 라이브룸에 초대할 수 있게 합니다.',
    'Automatic deduction for entering the private live broadcast room': '비공개 라이브룸 입장 자동 차감',
    'After opening, private rooms can automatically deduct diamonds.': '활성화하면 비공개 룸에서 다이아몬드가 자동 차감됩니다.',
    Blacklist: '차단 목록',
    'Blocked users are controlled from the chat user menu.': '차단 사용자는 채팅 사용자 메뉴에서 관리합니다.',
    'Live broadcast you are not interested in': '관심 없는 라이브 방송',
    'Filtered from your feed.': '피드에서 필터링됩니다.',
    'Visible in your feed.': '피드에 표시됩니다.',
    Filtered: '필터됨',
    Show: '표시',
    'Message privacy updated.': '메시지 개인정보 설정이 업데이트되었습니다.',
    'Private live invitation setting updated.': '비공개 라이브 초대 설정이 업데이트되었습니다.',
    'Private-room deduction setting updated.': '비공개 룸 차감 설정이 업데이트되었습니다.',
    'Live preference updated.': '라이브 선호 설정이 업데이트되었습니다.',
    'Restricted Mode': '제한 모드',
    'Hide potentially sensitive content.': '민감할 수 있는 콘텐츠를 숨깁니다.',
    'Warning Mode': '경고 모드',
    'Show a warning before sensitive rooms open.': '민감한 방을 열기 전에 경고를 표시합니다.',
    'All Modes': '모든 모드',
    'Show all room content that is available to your account.': '계정에서 이용 가능한 모든 방 콘텐츠를 표시합니다.',
    'selected.': '선택됨.',
    'Language changed to {language}.': '언어가 {language}(으)로 변경되었습니다.',
    'Search region': '지역 검색',
    'Region changed to {region}.': '지역이 {region}(으)로 변경되었습니다.',
    'Terms of Service': '서비스 약관',
    'Privacy Policy': '개인정보 처리방침',
    'Child Safety Policy': '아동 안전 정책',
    'Anti-Bullying Policy': '괴롭힘 방지 정책',
    Copyright: '저작권',
    '{policy} will open in the production policy page.': '{policy} 페이지가 프로덕션 정책 페이지에서 열립니다.',
  },
}
const shortLanguageCopy = {
  French: {
    'Account Security': 'Sécurité du compte',
    'Privacy Settings': 'Confidentialité',
    'Content Preferences': 'Préférences de contenu',
    'Multi-Language': 'Langues',
    Region: 'Région',
    'Terms and Policies': 'Conditions et politiques',
    'Changes are applied immediately for this session.': 'Les changements sont appliqués immédiatement.',
    'Language changed to {language}.': 'Langue changée en {language}.',
  },
  Italian: {
    'Account Security': 'Sicurezza account',
    'Privacy Settings': 'Privacy',
    'Content Preferences': 'Preferenze contenuti',
    'Multi-Language': 'Multilingua',
    Region: 'Regione',
    'Terms and Policies': 'Termini e norme',
    'Changes are applied immediately for this session.': 'Le modifiche vengono applicate subito.',
    'Language changed to {language}.': 'Lingua cambiata in {language}.',
  },
  Russian: {
    'Account Security': 'Безопасность аккаунта',
    'Privacy Settings': 'Конфиденциальность',
    'Content Preferences': 'Настройки контента',
    'Multi-Language': 'Языки',
    Region: 'Регион',
    'Terms and Policies': 'Условия и политики',
    'Changes are applied immediately for this session.': 'Изменения применяются сразу.',
    'Language changed to {language}.': 'Язык изменен на {language}.',
  },
  Spanish: {
    'Account Security': 'Seguridad de la cuenta',
    'Privacy Settings': 'Privacidad',
    'Content Preferences': 'Preferencias de contenido',
    'Multi-Language': 'Varios idiomas',
    Region: 'Región',
    'Terms and Policies': 'Términos y políticas',
    'Changes are applied immediately for this session.': 'Los cambios se aplican inmediatamente.',
    'Language changed to {language}.': 'Idioma cambiado a {language}.',
  },
  German: {
    'Account Security': 'Kontosicherheit',
    'Privacy Settings': 'Datenschutz',
    'Content Preferences': 'Inhaltseinstellungen',
    'Multi-Language': 'Mehrsprachig',
    Region: 'Region',
    'Terms and Policies': 'Bedingungen und Richtlinien',
    'Changes are applied immediately for this session.': 'Änderungen werden sofort angewendet.',
    'Language changed to {language}.': 'Sprache zu {language} geändert.',
  },
  Portuguese: {
    'Account Security': 'Segurança da conta',
    'Privacy Settings': 'Privacidade',
    'Content Preferences': 'Preferências de conteúdo',
    'Multi-Language': 'Multi-idioma',
    Region: 'Região',
    'Terms and Policies': 'Termos e políticas',
    'Changes are applied immediately for this session.': 'As alterações são aplicadas imediatamente.',
    'Language changed to {language}.': 'Idioma alterado para {language}.',
  },
  Hindi: {
    'Account Security': 'खाता सुरक्षा',
    'Privacy Settings': 'गोपनीयता सेटिंग',
    'Content Preferences': 'सामग्री पसंद',
    'Multi-Language': 'बहु-भाषा',
    Region: 'क्षेत्र',
    'Terms and Policies': 'नियम और नीतियां',
    'Changes are applied immediately for this session.': 'बदलाव तुरंत लागू होते हैं।',
    'Language changed to {language}.': 'भाषा {language} में बदल गई।',
  },
}
Object.entries(shortLanguageCopy).forEach(([language, copy]) => {
  settingsCopy[language] = { ...settingsCopy.English, ...copy }
})
const regions = [
  'Afghanistan',
  'Aland Islands',
  'Albania',
  'Algeria',
  'American Samoa',
  'Andorra',
  'Angola',
  'Anguilla',
  'Antarctica',
  'Antigua and Barbuda',
  'Argentina',
  'Armenia',
  'Aruba',
  'Australia',
  'Austria',
  'Azerbaijan',
  'Bahamas',
  'Bahrain',
  'Bangladesh',
  'Barbados',
  'Belarus',
  'Belgium',
  'Belize',
  'Benin',
  'Bermuda',
  'Bhutan',
  'Bolivia',
  'Bonaire, Sint Eustatius and Saba',
  'Bosnia and Herzegovina',
  'Botswana',
  'Bouvet Island',
  'Brazil',
  'British Indian Ocean Territory',
  'Brunei',
  'Bulgaria',
  'Burkina Faso',
  'Burundi',
  'Cabo Verde',
  'Cambodia',
  'Cameroon',
  'Canada',
  'Cayman Islands',
  'Central African Republic',
  'Chad',
  'Chile',
  'China',
  'Christmas Island',
  'Cocos Islands',
  'Colombia',
  'Comoros',
  'Congo',
  'Congo, Democratic Republic of the',
  'Cook Islands',
  'Costa Rica',
  "Cote d'Ivoire",
  'Croatia',
  'Cuba',
  'Curacao',
  'Cyprus',
  'Czechia',
  'Denmark',
  'Djibouti',
  'Dominica',
  'Dominican Republic',
  'Ecuador',
  'Egypt',
  'El Salvador',
  'Equatorial Guinea',
  'Eritrea',
  'Estonia',
  'Eswatini',
  'Ethiopia',
  'Falkland Islands',
  'Faroe Islands',
  'Fiji',
  'Finland',
  'France',
  'French Guiana',
  'French Polynesia',
  'French Southern Territories',
  'Gabon',
  'Gambia',
  'Georgia',
  'Germany',
  'Ghana',
  'Gibraltar',
  'Greece',
  'Greenland',
  'Grenada',
  'Guadeloupe',
  'Guam',
  'Guatemala',
  'Guernsey',
  'Guinea',
  'Guinea-Bissau',
  'Guyana',
  'Haiti',
  'Heard Island and McDonald Islands',
  'Holy See',
  'Honduras',
  'Hong Kong',
  'Hungary',
  'Iceland',
  'India',
  'Indonesia',
  'Iran',
  'Iraq',
  'Ireland',
  'Isle of Man',
  'Israel',
  'Italy',
  'Jamaica',
  'Japan',
  'Jersey',
  'Jordan',
  'Kazakhstan',
  'Kenya',
  'Kiribati',
  'Kosovo',
  'Kuwait',
  'Kyrgyzstan',
  'Laos',
  'Latvia',
  'Lebanon',
  'Lesotho',
  'Liberia',
  'Libya',
  'Liechtenstein',
  'Lithuania',
  'Luxembourg',
  'Macao',
  'Madagascar',
  'Malawi',
  'Malaysia',
  'Maldives',
  'Mali',
  'Malta',
  'Marshall Islands',
  'Martinique',
  'Mauritania',
  'Mauritius',
  'Mayotte',
  'Mexico',
  'Micronesia',
  'Moldova',
  'Monaco',
  'Mongolia',
  'Montenegro',
  'Montserrat',
  'Morocco',
  'Mozambique',
  'Myanmar',
  'Namibia',
  'Nauru',
  'Nepal',
  'Netherlands',
  'New Caledonia',
  'New Zealand',
  'Nicaragua',
  'Niger',
  'Nigeria',
  'Niue',
  'Norfolk Island',
  'North Korea',
  'North Macedonia',
  'Northern Mariana Islands',
  'Norway',
  'Oman',
  'Pakistan',
  'Palau',
  'Palestine',
  'Panama',
  'Papua New Guinea',
  'Paraguay',
  'Peru',
  'Philippines',
  'Pitcairn',
  'Poland',
  'Portugal',
  'Puerto Rico',
  'Qatar',
  'Reunion',
  'Romania',
  'Russia',
  'Rwanda',
  'Saint Barthelemy',
  'Saint Helena, Ascension and Tristan da Cunha',
  'Saint Kitts and Nevis',
  'Saint Lucia',
  'Saint Martin',
  'Saint Pierre and Miquelon',
  'Saint Vincent and the Grenadines',
  'Samoa',
  'San Marino',
  'Sao Tome and Principe',
  'Saudi Arabia',
  'Senegal',
  'Serbia',
  'Seychelles',
  'Sierra Leone',
  'Singapore',
  'Sint Maarten',
  'Slovakia',
  'Slovenia',
  'Solomon Islands',
  'Somalia',
  'South Africa',
  'South Georgia and the South Sandwich Islands',
  'South Korea',
  'South Sudan',
  'Spain',
  'Sri Lanka',
  'Sudan',
  'Suriname',
  'Svalbard and Jan Mayen',
  'Sweden',
  'Switzerland',
  'Syria',
  'Taiwan',
  'Tajikistan',
  'Tanzania',
  'Thailand',
  'Timor-Leste',
  'Togo',
  'Tokelau',
  'Tonga',
  'Trinidad and Tobago',
  'Tunisia',
  'Turkey',
  'Turkmenistan',
  'Turks and Caicos Islands',
  'Tuvalu',
  'Uganda',
  'Ukraine',
  'United Arab Emirates',
  'United Kingdom',
  'United States',
  'United States Minor Outlying Islands',
  'Uruguay',
  'Uzbekistan',
  'Vanuatu',
  'Venezuela',
  'Vietnam',
  'Virgin Islands, British',
  'Virgin Islands, U.S.',
  'Wallis and Futuna',
  'Western Sahara',
  'Yemen',
  'Zambia',
  'Zimbabwe',
]
const regionAliases = {
  'Cote d\'Ivoire': ['Ivory Coast'],
  'Czechia': ['Czech Republic'],
  'Congo': ['Republic of the Congo'],
  'Congo, Democratic Republic of the': ['DR Congo', 'Democratic Republic of Congo'],
  'Eswatini': ['Swaziland'],
  'Holy See': ['Vatican City', 'Vatican'],
  'Iran': ['Islamic Republic of Iran'],
  'Laos': ['Lao PDR'],
  'Macao': ['Macau'],
  'Myanmar': ['Burma'],
  'North Korea': ['Korea DPR'],
  'Palestine': ['Palestinian Territory'],
  'Russia': ['Russian Federation'],
  'South Korea': ['Korea', 'Republic of Korea'],
  'Syria': ['Syrian Arab Republic'],
  'Taiwan': ['Taiwan, Province of China'],
  'Tanzania': ['United Republic of Tanzania'],
  'Turkey': ['Turkiye'],
  'United Arab Emirates': ['UAE'],
  'United Kingdom': ['UK', 'Great Britain', 'Britain', 'England', 'Scotland', 'Wales', 'Northern Ireland'],
  'United States': ['USA', 'US', 'United States of America', 'America'],
  'Venezuela': ['Bolivarian Republic of Venezuela'],
  'Vietnam': ['Viet Nam'],
}
const paymentMethods = ['Google Pay', 'PayPal', 'Apple Pay', 'Visa/ MasterCard/ JCB/ AMEX/ DINERS', 'Dpay(USDT & Bitcoin)', 'Razer Gold Wallet']
const feedbackCategories = ['Account', 'Room / RTC', 'Payment', 'Chat', 'Safety']
const feedbackTypes = ['Bug report', 'Feature request', 'Payment issue', 'Abuse report', 'Other']
const maxFeedbackAttachmentSize = 25 * 1024 * 1024

const popularHelp = [
  { id: 'recharge', title: 'How to recharge', body: 'Open a live room, click More in the gift bar, choose a payment method, then use Recharge to add diamonds.' },
  { id: 'vip', title: 'How to become VIP/SVIP', body: 'Buy VIP through the personal center or use diamonds to buy VIP. VIP rewards and privileges are visible from the personal center.' },
  { id: 'bind', title: 'How do I bind my phone number and email address?', body: 'For account security, bind your mobile phone number and email address in Settings, Account Security.' },
  { id: 'mvp', title: 'How to become an MVP and its benefits', body: 'MVP status unlocks monthly rewards, profile progress, and room benefits after qualifying top-up milestones.' },
  { id: 'missing', title: "I made a payment, but I did not receive the diamonds", body: 'Check the payment record first. If the recharge is still missing, submit feedback with your payment time and receipt screenshot.' },
]

const faqTopics = [
  'Modify personal information',
  'Unfollow accounts that are frozen or deactivated',
  'How to create a voice chat room',
  'How do I bind my phone number and email address?',
  'How to upgrade the TalkEachOther app',
  "Delete the other people's comments on your post or private message with others",
  'The live streaming page cannot be opened or is not smooth',
  'How to do a live/private live broadcast',
  'Block others',
  'What can crystals be used for',
  'How to upgrade my account level',
  "Join other people's private broadcast",
  'Hide profile',
  'Turn off my location',
  'Delete video',
]
const faqAnswers = {
  'Modify personal information': 'Open your profile, edit the fields you want to change, then save. Some account security fields are managed from Settings.',
  'Unfollow accounts that are frozen or deactivated': 'Open the account page from your following list and use Unfollow. Frozen or deactivated accounts may take a short time to disappear from lists.',
  'How to create a voice chat room': 'Use the create room panel, choose an audio room type, complete the room details, and create the room.',
  'How do I bind my phone number and email address?': 'Go to Settings, Account Security, then use Binding cell phone or Binding email.',
  'How to upgrade the TalkEachOther app': 'Refresh the web app or install the latest app version from your browser install prompt when it is available.',
  "Delete the other people's comments on your post or private message with others": 'Use the message or comment menu. Room owners and moderators can remove disruptive room messages.',
  'The live streaming page cannot be opened or is not smooth': 'Check your network, close other heavy apps, refresh the room, and try a different room. If it continues, submit feedback with your device and network details.',
  'How to do a live/private live broadcast': 'Create a room, choose a live room type, then select public, private, or password privacy before publishing.',
  'Block others': 'Open the user menu from chat, profile, or room participants, then choose block or report when needed.',
  'What can crystals be used for': 'Crystals can be used for platform rewards and room interactions where enabled.',
  'How to upgrade my account level': 'Account level grows through activity, room participation, and supported platform reward actions.',
  "Join other people's private broadcast": 'Open the private room invitation or room card. If a password or permission is required, enter it before joining.',
  'Hide profile': 'Use privacy settings to limit who can message you and reduce discoverability where supported.',
  'Turn off my location': 'Disable browser location permission and choose a different region from Settings if needed.',
  'Delete video': 'Open your video or room media controls and choose delete. Moderation tools may also remove unsafe videos.',
}

const policyDocuments = [
  {
    id: 'terms',
    title: 'Terms of Service',
    summary: 'The basic rules for using TalkEachOther rooms, chat, profiles, gifts, and RTC features.',
    sections: [
      ['Account responsibility', 'You are responsible for activity from your account, keeping your login details private, and using accurate profile information.'],
      ['Room behavior', 'Do not harass people, impersonate others, share illegal content, or use live rooms for scams, private transactions, or harmful activity.'],
      ['Service changes', 'Features, rooms, moderation tools, gifts, and availability may change as the service improves or to protect the community.'],
    ],
  },
  {
    id: 'privacy',
    title: 'Privacy Policy',
    summary: 'How account, room, chat, device, and usage information is handled inside the platform.',
    sections: [
      ['Information we use', 'We use account details, room activity, messages, device signals, and usage records to run the service and keep rooms safe.'],
      ['Security and moderation', 'Safety teams and automated systems may review reports, moderation events, and abuse signals to protect users.'],
      ['Your choices', 'You can update profile details, manage privacy settings, and control room or message preferences from settings.'],
    ],
  },
  {
    id: 'child-safety',
    title: 'Child Safety Policy',
    summary: 'Rules that protect minors and remove unsafe content or behavior quickly.',
    sections: [
      ['Minimum age', 'Users must meet the required age for their region. Accounts that do not meet age requirements may be restricted or removed.'],
      ['Zero tolerance', 'Sexualized, exploitative, grooming, or predatory behavior involving minors is prohibited and may be reported to authorities.'],
      ['Reporting', 'Use Feedback and Help or moderation controls to report suspicious behavior, unsafe rooms, or child safety concerns immediately.'],
    ],
  },
  {
    id: 'anti-bullying',
    title: 'Anti-Bullying Policy',
    summary: 'Community rules for respectful live rooms, chat, direct messages, and profiles.',
    sections: [
      ['Harassment', 'Threats, targeted insults, hate speech, stalking, doxxing, and repeated unwanted contact are not allowed.'],
      ['Moderation tools', 'Room owners and moderators can mute, remove, block, or report users who disrupt rooms or attack others.'],
      ['Enforcement', 'Violations may lead to removed content, disabled rooms, account restrictions, or bans.'],
    ],
  },
  {
    id: 'copyright',
    title: 'Copyright',
    summary: 'Rules for sharing music, images, video, branding, and other protected content.',
    sections: [
      ['Your content', 'Only upload or stream content you own, created, licensed, or have permission to use.'],
      ['Claims', 'Copyright owners can report content that they believe infringes their rights. Valid reports may result in removal or account action.'],
      ['Repeat violations', 'Repeated copyright abuse can lead to room restrictions or account suspension.'],
    ],
  },
]

function initialsFromName(name) {
  return String(name || 'User')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'U'
}

function compactNumber(value) {
  const number = Number(value || 0)
  if (number >= 1000000) return `${(number / 1000000).toFixed(1)}M`
  if (number >= 1000) return `${(number / 1000).toFixed(number >= 10000 ? 0 : 1)}K`
  return String(number)
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Attachment could not be read. Please try another file.'))
    reader.readAsDataURL(file)
  })
}

function savedRoomSettings() {
  if (typeof window === 'undefined') return {}
  try {
    const saved = JSON.parse(window.localStorage.getItem('rtc_room_settings') || '{}')
    return saved && typeof saved === 'object' ? saved : {}
  } catch {
    return {}
  }
}

function savedFeedbackRecords() {
  if (typeof window === 'undefined') return []
  try {
    const saved = JSON.parse(window.localStorage.getItem('rtc_feedback_records') || '[]')
    return Array.isArray(saved) ? saved.slice(0, 20) : []
  } catch {
    return []
  }
}

function savedFollowedThreadIds(defaultIds) {
  if (typeof window === 'undefined') return defaultIds
  try {
    const saved = JSON.parse(window.localStorage.getItem('rtc_followed_thread_ids') || 'null')
    return Array.isArray(saved) ? saved.filter(Boolean) : defaultIds
  } catch {
    return defaultIds
  }
}

function formatFeedbackRecordDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Just now'
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function compactText(value, maxLength = 56) {
  const text = String(value || '').trim().replace(/\s+/g, ' ')
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 1)}...`
}

function threadPreview(thread, messages) {
  const lastMessage = messages[messages.length - 1]
  if (!lastMessage) return compactText(thread.preview || 'No messages yet')
  const prefix = lastMessage.mine ? 'You: ' : ''
  return compactText(`${prefix}${lastMessage.body}`)
}

function copyForLanguage(language, key, replacements = {}) {
  const template = settingsCopy[language]?.[key] || settingsCopy.English[key] || key
  return Object.entries(replacements).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, value),
    template
  )
}

function validEmail(value) {
  return /^[^\s@]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(String(value || '').trim())
}

function regionMatchesSearch(region, search) {
  const normalizedSearch = search.trim().toLowerCase()
  if (!normalizedSearch) return true
  return [region, ...(regionAliases[region] || [])]
    .some((value) => value.toLowerCase().includes(normalizedSearch))
}

function cardAvatarIndex(card, fallback = 0) {
  if (Number.isFinite(Number(card?.avatarIndex))) return Number(card.avatarIndex)
  if (card?.room?.id) return Number(card.room.id)
  const numericId = String(card?.id || '').match(/\d+/)?.[0]
  return Number(numericId || fallback)
}

function cardCover(card, fallback = 0) {
  if (card?.room) return coverForRoomType(card.room.room_type, card.room.privacy_type, cardAvatarIndex(card, fallback))
  if (card?.roomType || card?.privacy) return coverForRoomType(card.roomType, card.privacy, cardAvatarIndex(card, fallback))
  return coverForDemoTone(card?.tone, cardAvatarIndex(card, fallback))
}

function roomToFeedCard(room, index) {
  const meta = getRoomMeta(room.room_type)
  return {
    id: `room-${room.id}`,
    room,
    title: room.name || `Live room ${room.id}`,
    host: room.owner_name || 'Room host',
    viewers: Number(room.active_participants || 0) || 100 + index * 37,
    tone: ['aurora', 'warm', 'rose', 'sunset', 'slate', 'amber', 'night', 'plum'][index % 8],
    badge: room.privacy_type === 'password' ? 'Locked' : meta.short,
    category: meta.label,
    country: 'United States',
    size: index === 0 ? 'feature' : '',
    roomType: room.room_type,
    privacy: room.privacy_type,
    avatarIndex: Number(room.id) || index,
  }
}

function cardMatchesActiveFeed(card, activeFeed, activeExplore) {
  if (activeFeed === 'latest') return card.tab === 'latest' || card.room
  if (activeFeed === 'nearby') return card.tab === 'nearby' || card.room
  if (activeFeed === 'party') return card.party || card.tab === 'party' || card.room?.room_type === 'pk_live'
  if (activeFeed === 'following') return Boolean(card.room || card.following || card.host === 'TalkEachOther')
  if (activeFeed === 'global') return card.tab === 'latest' || card.room || card.country || card.host === 'TalkEachOther'
  if (activeFeed === 'explore') {
    if (activeExplore === 'all') return card.tab !== 'party'
    if (activeExplore === 'pk') return card.room?.room_type === 'pk_live' || card.explore === 'pk'
    if (activeExplore === 'games') return card.explore === 'games' || roomSupportsVideo(card.room?.room_type || card.roomType)
    return card.room || card.explore === activeExplore
  }

  return true
}

function cardMatchesRoomFilters(card, filter, privacyFilter) {
  const roomType = card.room?.room_type || card.roomType
  const privacyType = card.room?.privacy_type || card.privacy || 'public'
  const typeMatches = filter === 'all'
    || (filter === 'live' && ['video', 'group_video', 'solo_live', 'pk_live'].includes(roomType))
    || (filter === 'video' && roomSupportsVideo(roomType))
    || (filter === 'music' && ['audio', 'group_audio'].includes(roomType))
    || (filter === 'pk' && roomType === 'pk_live')
  const privacyMatches = privacyFilter === 'all' || privacyType === privacyFilter

  return typeMatches && privacyMatches
}

function sortCardsForView(cards, sort) {
  const nextCards = [...cards]

  if (sort === 'name') {
    nextCards.sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')))
  } else if (sort === 'active') {
    nextCards.sort((a, b) => Number(b.viewers || 0) - Number(a.viewers || 0))
  } else if (sort === 'oldest') {
    nextCards.sort((a, b) => Number(cardAvatarIndex(a)) - Number(cardAvatarIndex(b)))
  }

  return nextCards
}

function IconButton({ label, children, badge, className = '', onClick }) {
  return (
    <button type="button" className={`buzzcast-icon-button ${className}`} onClick={onClick} aria-label={label} title={label}>
      <span className="buzzcast-icon-inner">{children}</span>
      {badge ? <em>{badge}</em> : null}
    </button>
  )
}

function BuzzLogo() {
  return (
    <div className="buzzcast-logo">
      <div className="buzzcast-logo-mark image-mark">
        <img src={brandAssets.appIcon} alt="TalkEachOther" />
      </div>
      <div>
        <strong>TalkEachOther</strong>
        <span>Video and music rooms</span>
      </div>
    </div>
  )
}

function FeedCard({ card, featured, onOpen }) {
  const cover = cardCover(card)
  const avatarIndex = cardAvatarIndex(card)

  return (
    <article className={`buzzcast-room-card ${featured ? 'featured' : ''}`}>
      <button type="button" className="buzzcast-card-button" onClick={() => onOpen(card)}>
        <div className={`buzzcast-media media-${card.tone || 'aurora'}`}>
          <img className="buzzcast-media-image" src={cover} alt="" loading="lazy" />
          {card.badge ? <span className="buzzcast-card-badge">{card.badge}</span> : null}
          {card.sensitive ? <span className="buzzcast-sensitive-dot"></span> : null}
          <span className="buzzcast-viewers">{compactNumber(card.viewers)}</span>
          <span className="buzzcast-seat-dots">
            {[0, 1, 2].map((offset) => (
              <i key={offset}><img src={avatarForIndex(avatarIndex + offset)} alt="" loading="lazy" /></i>
            ))}
          </span>
        </div>
        <div className="buzzcast-card-copy">
          <strong>{card.title}</strong>
          <span>{card.host}</span>
        </div>
      </button>
    </article>
  )
}

export function RoomsView({ onEnterRoom, user, onLogout, onUserUpdated, onView, onAuthRequired }) {
  const [rooms, setRooms] = useState([])
  const [roomMeta, setRoomMeta] = useState({ page: 1, per_page: 24, total: 0, total_pages: 1 })
  const [status, setStatus] = useState('Ready')
  const [roomId, setRoomId] = useState('')
  const [selectedRoom, setSelectedRoom] = useState(null)
  const [joinPassword, setJoinPassword] = useState('')
  const [joinRtcMode, setJoinRtcMode] = useState('video')
  const [roomForm, setRoomForm] = useState(defaultRoomForm)
  const [formErrors, setFormErrors] = useState({})
  const [createdRoom, setCreatedRoom] = useState(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [privacyFilter, setPrivacyFilter] = useState('all')
  const [sort, setSort] = useState('newest')
  const [loadingRooms, setLoadingRooms] = useState(false)
  const [creating, setCreating] = useState(false)
  const [openingRoom, setOpeningRoom] = useState(false)
  const [activeSection, setActiveSection] = useState('live')
  const [activeFeed, setActiveFeed] = useState('for_you')
  const [activeExplore, setActiveExplore] = useState('all')
  const [showSearchPanel, setShowSearchPanel] = useState(false)
  const [showMessages, setShowMessages] = useState(false)
  const [showRankings, setShowRankings] = useState(false)
  const [showInstall, setShowInstall] = useState(false)
  const [showHostPanel, setShowHostPanel] = useState(false)
  const [showRecharge, setShowRecharge] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [installPrompt, setInstallPrompt] = useState(null)
  const [activeSettings, setActiveSettings] = useState('account')
  const [settingsStatus, setSettingsStatus] = useState('')
  const [selectedPolicyId, setSelectedPolicyId] = useState('')
  const [settingsDraft, setSettingsDraft] = useState(() => {
    const saved = savedRoomSettings()
    return {
      phoneBound: Boolean(saved.phoneBound),
      emailBound: Boolean(saved.emailBound || user?.email),
      loginPasswordSet: saved.loginPasswordSet !== false,
      paymentPasswordSet: Boolean(saved.paymentPasswordSet),
      deviceAlerts: saved.deviceAlerts !== false,
      messagePrivacy: saved.messagePrivacy || 'everyone',
      privateInvite: saved.privateInvite !== false,
      autoPrivateDeduction: Boolean(saved.autoPrivateDeduction),
      hideSensitive: saved.hideSensitive !== false,
      contentMode: saved.contentMode || 'warning',
      region: user?.current_residence || saved.region || 'United States',
    }
  })
  const [securityAction, setSecurityAction] = useState(null)
  const [securityForm, setSecurityForm] = useState({
    phone: '',
    email: user?.email || '',
    password: '',
    passwordConfirm: '',
    paymentPin: '',
    paymentPinConfirm: '',
  })
  const [securityError, setSecurityError] = useState('')
  const [helpMode, setHelpMode] = useState('popular')
  const [activeHelp, setActiveHelp] = useState('recharge')
  const [activeFaq, setActiveFaq] = useState(faqTopics[0])
  const [activeThread, setActiveThread] = useState(dmThreads[0].id)
  const [dmMessages, setDmMessages] = useState(initialDmMessages)
  const [dmInput, setDmInput] = useState('')
  const [dmStatus, setDmStatus] = useState('')
  const [readThreadIds, setReadThreadIds] = useState([])
  const [followedThreadIds, setFollowedThreadIds] = useState(() => savedFollowedThreadIds(dmThreads.filter((thread) => thread.followed).map((thread) => thread.id)))
  const [activeRanking, setActiveRanking] = useState('rooms')
  const [previewCard, setPreviewCard] = useState(null)
  const [acceptedWarnings, setAcceptedWarnings] = useState({})
  const [feedbackForm, setFeedbackForm] = useState({
    category: feedbackCategories[0],
    type: feedbackTypes[0],
    description: '',
    contact: user?.email || '',
    attachment: null,
  })
  const [feedbackRecords, setFeedbackRecords] = useState(savedFeedbackRecords)
  const [feedbackStatus, setFeedbackStatus] = useState('')
  const [submittingFeedback, setSubmittingFeedback] = useState(false)

  const displayName = user?.name || user?.email?.split('@')[0] || 'Guest'
  const displayId = user?.id || 0
  const profileInitials = initialsFromName(displayName)
  const showAdminDashboard = canUseAdminDashboard(user) === true
  const selectedRoomNeedsPassword = selectedRoom?.privacy_type === 'password' && roomId === String(selectedRoom.id)
  const selectedRoomSupportsVideo = !selectedRoom || roomSupportsVideo(selectedRoom.room_type)
  const canJoinRoom = Boolean(roomId.trim()) && !openingRoom && (!selectedRoomNeedsPassword || Boolean(joinPassword.trim()))
  const t = (key, replacements = {}) => copyForLanguage('English', key, replacements)

  const roomCards = useMemo(() => rooms.map(roomToFeedCard), [rooms])
  const visibleCards = useMemo(() => {
    const usingLiveRooms = roomCards.length > 0
    let cards = usingLiveRooms ? [...roomCards] : [...demoCards]

    if (usingLiveRooms) {
      if (activeFeed === 'party') cards = cards.filter((card) => card.room?.room_type === 'pk_live')
      if (activeFeed === 'explore' && activeExplore === 'pk') cards = cards.filter((card) => card.room?.room_type === 'pk_live')
      if (activeFeed === 'explore' && activeExplore === 'games') cards = cards.filter((card) => roomSupportsVideo(card.room?.room_type))
      return sortCardsForView(cards.filter((card) => cardMatchesRoomFilters(card, filter, privacyFilter)), sort).slice(0, 48)
    }

    if (activeFeed === 'latest') cards = cards.filter((card) => card.tab === 'latest' || card.room).slice(0, 16)
    if (activeFeed === 'nearby') cards = cards.filter((card) => card.tab === 'nearby' || card.room).slice(0, 16)
    if (activeFeed === 'party') cards = cards.filter((card) => card.party || card.tab === 'party' || card.room?.room_type === 'pk_live')
    if (activeFeed === 'explore') {
      cards = cards.filter((card) => {
        if (activeExplore === 'all') return card.tab !== 'party'
        if (activeExplore === 'pk') return card.room?.room_type === 'pk_live' || card.explore === 'pk'
        if (activeExplore === 'games') return card.explore === 'games' || roomSupportsVideo(card.room?.room_type)
        return card.room || card.explore === activeExplore
      })
    }
    if (activeFeed === 'following') cards = cards.filter((card, index) => card.room || index < 6)
    if (activeFeed === 'global') cards = cards.filter((card) => card.tab === 'latest' || card.room).concat(demoCards.slice(0, 4))

    cards = cards.filter((card) => cardMatchesRoomFilters(card, filter, privacyFilter))
    return sortCardsForView(cards, sort).slice(0, activeFeed === 'party' ? 10 : 24)
  }, [activeExplore, activeFeed, filter, privacyFilter, roomCards, sort])
  const searchTerm = search.trim().toLowerCase()
  const roomSearchResults = useMemo(() => {
    const includesTerm = (value) => String(value || '').toLowerCase().includes(searchTerm)
    const candidateCards = (roomCards.length ? roomCards : demoCards)
      .filter((card) => cardMatchesActiveFeed(card, activeFeed, activeExplore))
      .filter((card) => cardMatchesRoomFilters(card, filter, privacyFilter))
      .filter((card) => !searchTerm || includesTerm(`${card.title} ${card.host} ${card.roomType} ${card.badge} ${card.category} ${card.privacy || 'public'} ${card.country}`))

    return candidateCards.slice(0, 8).map((card) => ({
      id: card.id,
      type: card.room ? 'room' : 'demo',
      name: card.title,
      detail: `${getRoomMeta(card.roomType).label} - ${card.privacy || 'public'}`,
      avatarIndex: cardAvatarIndex(card),
      room: card.room,
      card,
    }))
  }, [activeExplore, activeFeed, filter, privacyFilter, roomCards, searchTerm])

  const activeHelpItem = popularHelp.find((item) => item.id === activeHelp) || popularHelp[0]
  const messageThreads = useMemo(() => dmThreads.map((thread, index) => {
    const messages = dmMessages[thread.id] || []
    const unread = readThreadIds.includes(thread.id) ? 0 : Number(thread.unread || 0)
    return {
      ...thread,
      avatarIndex: index,
      previewText: threadPreview(thread, messages),
      unread,
    }
  }), [dmMessages, readThreadIds])
  const activeThreadData = messageThreads.find((thread) => thread.id === activeThread) || messageThreads[0]
  const activeFilterLabel = roomFilterOptions.find((option) => option.value === filter)?.label || 'For You'
  const searchPanelTitle = loadingRooms
    ? 'Searching rooms...'
    : search.trim()
      ? `${roomSearchResults.length} ${activeFilterLabel} result${roomSearchResults.length === 1 ? '' : 's'}`
      : `${activeFilterLabel} rooms`
  const activeThreadFollowed = followedThreadIds.includes(activeThread)
  const unreadThreadCount = messageThreads.reduce((total, thread) => total + Number(thread.unread || 0), 0)
  const sentBeforeFollowCount = (dmMessages[activeThread] || []).filter((message) => message.mine).length
  const dmNotice = activeThreadFollowed
    ? 'You follow each other. Private messages are open.'
    : 'Follow this user to keep sending and receiving private messages.'
  const rankingRows = useMemo(() => {
    const cards = roomCards.length ? roomCards : demoCards

    if (activeRanking === 'hosts') {
      const hosts = new Map()
      cards.forEach((card) => {
        const key = card.host || 'Room host'
        const previous = hosts.get(key) || {
          key,
          name: key,
          detail: '0 rooms',
          score: 0,
          avatarIndex: cardAvatarIndex(card),
        }
        previous.score += Number(card.viewers || 0) + (card.room ? 120 : 0)
        previous.rooms = Number(previous.rooms || 0) + 1
        previous.detail = `${previous.rooms} room${previous.rooms === 1 ? '' : 's'} hosted`
        hosts.set(key, previous)
      })
      return Array.from(hosts.values()).sort((a, b) => b.score - a.score).slice(0, 10)
    }

    if (activeRanking === 'gifts') {
      return giftCatalog
        .slice()
        .sort((a, b) => Number(b.cost || 0) - Number(a.cost || 0))
        .slice(0, 10)
        .map((gift, index) => ({
          key: gift.id,
          name: gift.label,
          detail: `${gift.cost} diamonds`,
          score: Number(gift.cost || 0) * (10 - index),
          icon: gift.icon,
        }))
    }

    return cards
      .map((card) => ({
        key: card.id,
        name: card.title,
        detail: `${card.host} - ${getRoomMeta(card.roomType).label}`,
        score: Number(card.viewers || 0) + (card.room ? Number(card.room.active_participants || 0) * 25 : 0),
        avatarIndex: cardAvatarIndex(card),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
  }, [activeRanking, roomCards])

  function requireAuth(reason = 'Log in or sign up to continue.', mode = 'login') {
    if (user) return true
    onAuthRequired?.(reason, mode)
    return false
  }

  function pushSectionHistory(section, options = {}) {
    if (typeof window === 'undefined') return

    const state = {
      ...(window.history.state || {}),
      view: 'rooms',
      activeRoom: null,
      buzzcastSection: section,
      previewCardId: options.previewCardId || null,
    }
    const path = section === 'room' && options.previewCardId
      ? `/preview/${encodeURIComponent(options.previewCardId)}`
      : section === 'live'
        ? '/'
        : `/${section}`

    window.history.pushState(state, '', path)
  }

  function applySectionFromHistory(state = {}) {
    const section = state.buzzcastSection || 'live'
    if (section === 'room' && state.previewCardId) {
      const card = demoCards.find((item) => item.id === state.previewCardId)
      if (card) {
        setPreviewCard(card)
        setActiveSection('room')
        return
      }
    }

    if (['live', 'me', 'settings', 'help'].includes(section)) {
      setActiveSection(section)
      if (section !== 'room') setPreviewCard(null)
    }
  }

  function openProfileSection() {
    if (!requireAuth('Log in or sign up to open your profile.', 'login')) return
    pushSectionHistory('me')
    setActiveSection('me')
  }

  function openSettingsSection(nextSettings = activeSettings) {
    if (!requireAuth('Log in to manage your account settings.', 'login')) return
    pushSectionHistory('settings')
    setActiveSettings(nextSettings)
    setActiveSection('settings')
  }

  function openHostPanel(reason = 'Log in or sign up to create a live room.') {
    if (!requireAuth(reason, 'register')) return
    setShowHostPanel(true)
  }

  function openMessagesDrawer() {
    if (!requireAuth('Log in to open messages and chat with people.', 'login')) return
    setShowRankings(false)
    setReadThreadIds((previous) => previous.includes(activeThread) ? previous : [...previous, activeThread])
    setShowMessages(true)
  }

  function openRankings() {
    if (!requireAuth('Log in to view live rankings.', 'login')) return
    setShowMessages(false)
    setShowRankings(true)
  }

  function openRechargePanel() {
    if (!requireAuth('Log in to use wallet and room gifts.', 'login')) return
    setShowRecharge(true)
  }

  function updateSettings(field, value, message) {
    setSettingsDraft((previous) => ({ ...previous, [field]: value }))
    setSettingsStatus(message)
  }

  function openSecurityAction(field) {
    setSecurityAction(field)
    setSecurityError('')
    setSecurityForm((previous) => ({
      ...previous,
      email: previous.email || user?.email || '',
      password: '',
      passwordConfirm: '',
      paymentPin: '',
      paymentPinConfirm: '',
    }))
  }

  function updateSecurityForm(field, value) {
    setSecurityForm((previous) => ({ ...previous, [field]: value }))
    setSecurityError('')
  }

  function submitSecurityAction(event) {
    event.preventDefault()

    if (securityAction === 'phoneBound') {
      const digits = securityForm.phone.replace(/\D/g, '')
      if (digits.length < 7) {
        setSecurityError(t('Enter a valid phone number.'))
        return
      }
      setSecurityAction(null)
      updateSettings('phoneBound', true, t('Cell phone bound.'))
      return
    }

    if (securityAction === 'emailBound') {
      if (!validEmail(securityForm.email)) {
        setSecurityError(t('Enter a valid email address.'))
        return
      }
      setSecurityAction(null)
      updateSettings('emailBound', true, t('Email bound.'))
      return
    }

    if (securityAction === 'loginPasswordSet') {
      if (securityForm.password.length < 10) {
        setSecurityError(t('Use at least 10 characters for the password.'))
        return
      }
      if (securityForm.password !== securityForm.passwordConfirm) {
        setSecurityError(t('Passwords do not match.'))
        return
      }
      setSecurityAction(null)
      updateSettings('loginPasswordSet', true, t('Login password set.'))
      return
    }

    if (securityAction === 'paymentPasswordSet') {
      if (!/^\d{6}$/.test(securityForm.paymentPin)) {
        setSecurityError(t('Use a 6 digit payment PIN.'))
        return
      }
      if (securityForm.paymentPin !== securityForm.paymentPinConfirm) {
        setSecurityError(t('Payment PINs do not match.'))
        return
      }
      setSecurityAction(null)
      updateSettings('paymentPasswordSet', true, t('Payment password set.'))
    }
  }

  function updateFeedback(field, value) {
    setFeedbackForm((previous) => ({ ...previous, [field]: value }))
    setFeedbackStatus('')
  }

  function handleFeedbackAttachment(event) {
    const file = event.target.files?.[0]
    if (!file) return

    if (file.size > maxFeedbackAttachmentSize) {
      event.target.value = ''
      setFeedbackStatus('Attachment must be 25 MB or smaller.')
      return
    }

    updateFeedback('attachment', file)
    setFeedbackStatus(`${file.name} attached.`)
  }

  function removeFeedbackAttachment() {
    setFeedbackForm((previous) => ({ ...previous, attachment: null }))
    setFeedbackStatus('Attachment removed.')
  }

  function saveFeedbackRecord(record) {
    setFeedbackRecords((previous) => {
      const next = [record, ...previous].slice(0, 20)
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('rtc_feedback_records', JSON.stringify(next))
      }
      return next
    })
  }

  function toggleThreadFollow(threadId = activeThread) {
    setFollowedThreadIds((previous) => {
      const following = previous.includes(threadId)
      const next = following ? previous.filter((id) => id !== threadId) : [...previous, threadId]
      const thread = dmThreads.find((item) => item.id === threadId)
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('rtc_followed_thread_ids', JSON.stringify(next))
      }
      setDmStatus(following
        ? `${thread?.name || 'User'} unfollowed. Message sending returns to first-contact limits.`
        : `You are now following ${thread?.name || 'this user'}. You can send and receive private messages normally.`)
      return next
    })
  }

  function updateRoomForm(field, value) {
    setRoomForm((previous) => ({ ...previous, [field]: value }))
    setFormErrors((previous) => {
      if (!previous[field]) return previous
      const next = { ...previous }
      delete next[field]
      return next
    })
  }

  function selectRoom(room) {
    setSelectedRoom(room)
    setRoomId(String(room.id))
    setJoinPassword('')
    setJoinRtcMode(defaultRtcModeForRoom(room))
    setStatus(room.privacy_type === 'password' ? `Room #${room.id} needs a password before joining.` : `Room #${room.id} selected.`)
  }

  function openSearchResult(item) {
    setShowSearchPanel(false)

    if (item.room) {
      setActiveSection('live')
      setPreviewCard(null)
      joinRoomFromCard(item.room)
      return
    } else if (item.card) {
      openCard(item.card)
    }
  }

  function runSearch() {
    setActiveSection('live')
    setShowSearchPanel(true)
    loadRooms({
      page: 1,
      searchValue: search,
      filterValue: filter,
      privacyValue: privacyFilter,
      sortValue: sort,
    })
  }

  function handleSearchKeyDown(event) {
    if (event.key === 'Escape') {
      setShowSearchPanel(false)
      return
    }

    if (event.key !== 'Enter') return
    event.preventDefault()
    if (roomSearchResults[0]) {
      openSearchResult(roomSearchResults[0])
      return
    }

    runSearch()
  }

  function clearSelectedRoomIfManual(value) {
    setRoomId(value)
    if (selectedRoom && value !== String(selectedRoom.id)) {
      setSelectedRoom(null)
      setJoinPassword('')
    }
  }

  function updateJoinRtcMode(value) {
    setJoinRtcMode(normalizeRtcMode(value, selectedRoom))
  }

  function openLiveSection() {
    pushSectionHistory('live')
    setActiveSection('live')
    setPreviewCard(null)
  }

  function switchFeed(nextFeed) {
    const tab = feedTabs.find((item) => item.value === nextFeed)
    setActiveSection('live')
    setPreviewCard(null)
    setActiveFeed(nextFeed)
    if (tab?.filter) setFilter(tab.filter)
    if (tab?.sort) setSort(tab.sort)
  }

  function switchExplore(nextExplore) {
    const next = exploreFilters.find((item) => item.value === nextExplore)
    setActiveExplore(nextExplore)
    if (activeFeed === 'explore') setFilter(next?.filter || 'all')
  }

  async function loadRooms({
    page = roomMeta.page,
    searchValue = search,
    filterValue = filter,
    privacyValue = privacyFilter,
    sortValue = sort,
    quiet = false,
  } = {}) {
    setLoadingRooms(true)
    const path = buildRoomsPath({
      page,
      search: searchValue,
      filter: filterValue,
      privacy: privacyValue,
      sort: sortValue,
    })

    function applyRoomData(data) {
      const meta = data.rooms?.meta || { page, per_page: 24, total: 0, total_pages: 1 }
      setRooms(data.rooms?.data || [])
      setRoomMeta(meta)
      setStatus(meta.total === 1 ? 'Showing 1 room' : `Showing ${meta.total} rooms`)
    }

    try {
      if (!quiet) setStatus('Loading rooms...')
      applyRoomData(await apiRequest(path))
    } catch (error) {
      if (error.status === 401) {
        try {
          applyRoomData(await apiRequest(path))
          return
        } catch (retryError) {
          setStatus(retryError.message)
          return
        }
      }

      setStatus(error.message)
    } finally {
      setLoadingRooms(false)
    }
  }

  async function createRoom(event) {
    event.preventDefault()
    if (!requireAuth('Log in or sign up to create a live room.', 'register')) return

    const nextErrors = validateRoomForm(roomForm)
    setFormErrors(nextErrors)

    if (Object.keys(nextErrors).length) {
      setStatus('Please fix the highlighted room details.')
      return
    }

    const payload = roomFormPayload(roomForm)
    setCreating(true)
    try {
      setStatus('Creating room...')
      const data = await apiRequest('/rooms', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setRoomId(String(data.room.id))
      setSelectedRoom(data.room)
      setJoinPassword(payload.password || '')
      setJoinRtcMode(defaultRtcModeForRoom(data.room))
      setCreatedRoom(data.room)
      setStatus(`Created room #${data.room.id}`)
      setSearch('')
      setFilter('all')
      setPrivacyFilter('all')
      setSort('newest')
      updateRoomForm('password', '')
      await loadRooms({
        page: 1,
        searchValue: '',
        filterValue: 'all',
        privacyValue: 'all',
        sortValue: 'newest',
        quiet: true,
      })
    } catch (error) {
      if (error.errors && Object.keys(error.errors).length) setFormErrors(error.errors)
      setStatus(error.message)
    } finally {
      setCreating(false)
    }
  }

  async function joinSelectedRoom() {
    if (!roomId.trim()) return
    if (!requireAuth('Log in to open the RTC console.', 'login')) return
    if (selectedRoomNeedsPassword && !joinPassword.trim()) {
      setStatus('Enter the room password before joining.')
      return
    }

    try {
      setOpeningRoom(true)
      setStatus('Checking room access...')
      const roomData = selectedRoom && roomId.trim() === String(selectedRoom.id)
        ? { room: selectedRoom }
        : await apiRequest(`/rooms/${roomId.trim()}`)
      const targetRoom = roomData.room

      if (targetRoom?.privacy_type === 'password' && !joinPassword.trim()) {
        setSelectedRoom(targetRoom)
        setJoinRtcMode(defaultRtcModeForRoom(targetRoom))
        setStatus('Enter the room password before opening the RTC console.')
        return
      }

      onEnterRoom(roomId.trim(), {
        password: joinPassword.trim(),
        room: targetRoom,
        rtcMode: normalizeRtcMode(joinRtcMode, targetRoom),
        autoConnect: true,
      })
    } catch (error) {
      setStatus(error.message)
    } finally {
      setOpeningRoom(false)
    }
  }

  function joinRoomFromCard(room) {
    if (!requireAuth('Log in to join live rooms.', 'login')) return

    if (room.privacy_type === 'password') {
      selectRoom(room)
      setShowHostPanel(true)
      return
    }

    onEnterRoom(String(room.id), { room, rtcMode: defaultRtcModeForRoom(room), autoConnect: true })
  }

  function openCard(card) {
    if (card.room) {
      joinRoomFromCard(card.room)
      return
    }

    pushSectionHistory('room', { previewCardId: card.id })
    setPreviewCard(card)
    setActiveSection('room')
  }

  function sendDmMessage(event) {
    event.preventDefault()
    if (!requireAuth('Log in to send chat messages.', 'login')) return
    const body = dmInput.trim()
    if (!body) return
    if (!activeThreadFollowed && sentBeforeFollowCount >= 2) {
      setDmStatus('Follow this user first to continue the private chat.')
      return
    }

    setDmMessages((previous) => ({
      ...previous,
      [activeThread]: [
        ...(previous[activeThread] || []),
        { id: `${activeThread}-${Date.now()}`, author: displayName, body, mine: true, createdAt: new Date().toISOString() },
      ],
    }))
    setDmInput('')
    setReadThreadIds((previous) => previous.includes(activeThread) ? previous : [...previous, activeThread])
    setDmStatus(activeThreadFollowed
      ? `Sent to ${activeThreadData.name}: "${compactText(body, 44)}"`
      : `${Math.max(0, 1 - sentBeforeFollowCount)} first-contact message remaining before follow is required.`)
  }

  async function submitFeedback(event) {
    event.preventDefault()
    if (submittingFeedback) return

    if (feedbackForm.description.trim().length < 10) {
      setFeedbackStatus('Please add at least 10 characters so support can understand the issue.')
      return
    }

    try {
      setSubmittingFeedback(true)
      setFeedbackStatus(feedbackForm.attachment ? 'Preparing attachment...' : 'Sending feedback...')

      const attachmentMeta = feedbackForm.attachment ? {
        name: feedbackForm.attachment.name,
        type: feedbackForm.attachment.type,
        size: feedbackForm.attachment.size,
      } : null
      const attachment = attachmentMeta ? {
        ...attachmentMeta,
        data_url: await fileToDataUrl(feedbackForm.attachment),
      } : null

      setFeedbackStatus('Sending feedback...')
      await apiRequest('/feedback', {
        method: 'POST',
        body: JSON.stringify({
          category: feedbackForm.category,
          type: feedbackForm.type,
          description: feedbackForm.description.trim(),
          contact: feedbackForm.contact.trim(),
          attachment,
          page_url: typeof window !== 'undefined' ? window.location.href : '',
          user_agent: typeof window !== 'undefined' ? window.navigator.userAgent : '',
        }),
      })

      saveFeedbackRecord({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        category: feedbackForm.category,
        type: feedbackForm.type,
        description: feedbackForm.description.trim(),
        contact: feedbackForm.contact.trim(),
        attachment: attachmentMeta,
        created_at: new Date().toISOString(),
      })
      setHelpMode('records')
      setFeedbackStatus('Feedback sent to support.')
      window.setTimeout(() => {
        setShowFeedback(false)
        setFeedbackStatus('')
        setFeedbackForm({
          category: feedbackCategories[0],
          type: feedbackTypes[0],
          description: '',
          contact: user?.email || '',
          attachment: null,
        })
      }, 900)
    } catch (error) {
      setFeedbackStatus(error.message || 'Feedback could not be sent. Please try again.')
    } finally {
      setSubmittingFeedback(false)
    }
  }

  async function handleInstallApp() {
    if (installPrompt) {
      installPrompt.prompt()
      await installPrompt.userChoice.catch(() => null)
      setInstallPrompt(null)
      setShowInstall(false)
      return
    }

    setStatus('Use the browser install button when it appears for this app.')
    setShowInstall(false)
  }

  function renderLiveFeed() {
    return (
      <section className="buzzcast-discover">
        <nav className="buzzcast-feed-nav" aria-label="Room feed">
          {feedTabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              className={activeFeed === tab.value ? 'active' : ''}
              onClick={() => switchFeed(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {activeFeed === 'explore' ? (
          <div className="buzzcast-filter-pills">
            {exploreFilters.map((option) => (
              <button
                key={option.value}
                type="button"
                className={activeExplore === option.value ? 'active' : ''}
                onClick={() => switchExplore(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="buzzcast-match-banner">
          <strong>Live rooms built for video, music, chat, gifts, and enterprise RTC demos</strong>
          <button type="button" onClick={() => openHostPanel()}>Create room</button>
        </div>

        <div className="buzzcast-feed-controls">
          <span>{visibleCards.length} rooms - {loadingRooms ? 'Refreshing rooms...' : status}</span>
          <div>
            <select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Room type filter">
              {roomFilterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <select value={privacyFilter} onChange={(event) => setPrivacyFilter(event.target.value)} aria-label="Room privacy filter">
              {privacyFilterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Room sort">
              {roomSortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
        </div>

        {loadingRooms && rooms.length === 0 ? (
          <div className="buzzcast-empty-state">Loading rooms...</div>
        ) : visibleCards.length === 0 ? (
          <div className="buzzcast-empty-state visual">
            <img src={roomAssets.studioStage} alt="" loading="lazy" />
            <div>
              <strong>No matching rooms yet</strong>
              <span>Create one or adjust the filters to bring live rooms into this grid.</span>
            </div>
          </div>
        ) : (
          <>
            <div className={`buzzcast-card-grid ${activeFeed === 'party' ? 'party-grid' : ''}`}>
              {visibleCards.map((card, index) => (
                <FeedCard
                  key={card.id}
                  card={card}
                  featured={index === 0 && activeFeed !== 'party'}
                  onOpen={openCard}
                />
              ))}
            </div>

            {roomMeta.total_pages > 1 ? (
              <div className="buzzcast-pagination">
                <button type="button" onClick={() => loadRooms({ page: Math.max(1, roomMeta.page - 1) })} disabled={loadingRooms || roomMeta.page <= 1}>Previous</button>
                <span>{roomMeta.total} total rooms</span>
                <button type="button" onClick={() => loadRooms({ page: Math.min(roomMeta.total_pages, roomMeta.page + 1) })} disabled={loadingRooms || roomMeta.page >= roomMeta.total_pages}>Next</button>
              </div>
            ) : null}
          </>
        )}
      </section>
    )
  }

  function renderProfile() {
    return <ProfilePanel user={user} onSaved={onUserUpdated} onLogout={onLogout} />
  }

  function renderSettingsContent() {
    if (activeSettings === 'privacy') {
      return (
        <div className="buzzcast-settings-list">
          <label className="buzzcast-select-row">
            <span><strong>{t('Who can send me a message')}</strong><small>{t('Controls the personal inbox and room chat shortcuts.')}</small></span>
            <select
              value={settingsDraft.messagePrivacy}
              onChange={(event) => updateSettings('messagePrivacy', event.target.value, t('Message privacy updated.'))}
            >
              <option value="everyone">{t('Everyone')}</option>
              <option value="followers">{t('Followers only')}</option>
              <option value="nobody">{t('Nobody')}</option>
            </select>
          </label>
          <label className="buzzcast-switch-row">
            <span><strong>{t('Private live invitation')}</strong><small>{t('Allow hosts to invite you into private live rooms.')}</small></span>
            <input
              type="checkbox"
              checked={settingsDraft.privateInvite}
              onChange={(event) => updateSettings('privateInvite', event.target.checked, t('Private live invitation setting updated.'))}
            />
          </label>
          <label className="buzzcast-switch-row">
            <span><strong>{t('Automatic deduction for entering the private live broadcast room')}</strong><small>{t('After opening, private rooms can automatically deduct diamonds.')}</small></span>
            <input
              type="checkbox"
              checked={settingsDraft.autoPrivateDeduction}
              onChange={(event) => updateSettings('autoPrivateDeduction', event.target.checked, t('Private-room deduction setting updated.'))}
            />
          </label>
          <button type="button" onClick={() => setSettingsStatus('Use Block in the chat panel to hide a user and remove their messages from your view.')}>
            <span><strong>{t('Blacklist')}</strong><small>{t('Blocked users are controlled from the chat user menu.')}</small></span>
            <b>&gt;</b>
          </button>
          <button type="button" onClick={() => updateSettings('hideSensitive', !settingsDraft.hideSensitive, t('Live preference updated.'))}>
            <span><strong>{t('Live broadcast you are not interested in')}</strong><small>{settingsDraft.hideSensitive ? t('Filtered from your feed.') : t('Visible in your feed.')}</small></span>
            <em>{settingsDraft.hideSensitive ? t('Filtered') : t('Show')}</em>
          </button>
        </div>
      )
    }

    if (activeSettings === 'content') {
      const modes = [
        { value: 'restricted', labelKey: 'Restricted Mode', helperKey: 'Hide potentially sensitive content.' },
        { value: 'warning', labelKey: 'Warning Mode', helperKey: 'Show a warning before sensitive rooms open.' },
        { value: 'all', labelKey: 'All Modes', helperKey: 'Show all room content that is available to your account.' },
      ]

      return (
        <div className="buzzcast-settings-list">
          {modes.map((item) => (
            <label key={item.value} className={settingsDraft.contentMode === item.value ? 'buzzcast-radio-row selected' : 'buzzcast-radio-row'}>
              <span><strong>{t(item.labelKey)}</strong><small>{t(item.helperKey)}</small></span>
              <input
                type="radio"
                name="content-mode"
                checked={settingsDraft.contentMode === item.value}
                onChange={() => updateSettings('contentMode', item.value, `${t(item.labelKey)} ${t('selected.')}`)}
              />
            </label>
          ))}
        </div>
      )
    }

    if (activeSettings === 'region') {
      const regionSearch = settingsDraft.regionSearch || ''
      const visibleRegions = regions.filter((item) => regionMatchesSearch(item, regionSearch))

      return (
        <div className="buzzcast-region-panel">
          <input
            placeholder={t('Search region')}
            value={regionSearch}
            onChange={(event) => setSettingsDraft((previous) => ({ ...previous, regionSearch: event.target.value }))}
          />
          <div className="buzzcast-settings-list compact">
            {visibleRegions.map((item) => (
              <label key={item} className={settingsDraft.region === item ? 'buzzcast-radio-row selected' : 'buzzcast-radio-row'}>
                <span><strong>{item}</strong></span>
                <input
                  type="radio"
                  name="region"
                  checked={settingsDraft.region === item}
                  onChange={() => {
                    setSettingsDraft((previous) => ({ ...previous, region: item, regionSearch: '' }))
                    setSettingsStatus(t('Region changed to {region}.', { region: item }))
                  }}
                />
              </label>
            ))}
            {visibleRegions.length === 0 ? (
              <div className="buzzcast-region-empty">No region matches this search.</div>
            ) : null}
          </div>
        </div>
      )
    }

    if (activeSettings === 'terms') {
      const selectedPolicy = policyDocuments.find((item) => item.id === selectedPolicyId)

      if (selectedPolicy) {
        return (
          <article className="buzzcast-policy-detail">
            <button type="button" className="buzzcast-policy-back" onClick={() => {
              setSelectedPolicyId('')
              setSettingsStatus('')
            }}>
              &lt; Back
            </button>
            <h3>{selectedPolicy.title}</h3>
            <p>{selectedPolicy.summary}</p>
            {selectedPolicy.sections.map(([title, body]) => (
              <section key={title}>
                <h4>{title}</h4>
                <p>{body}</p>
              </section>
            ))}
          </article>
        )
      }

      return (
        <div className="buzzcast-settings-list">
          {policyDocuments.map((item) => (
            <button type="button" key={item.id} onClick={() => {
              setSelectedPolicyId(item.id)
              setSettingsStatus(item.summary)
            }}>
              <span><strong>{item.title}</strong><small>{item.summary}</small></span>
              <b>&gt;</b>
            </button>
          ))}
        </div>
      )
    }

    const accountRows = [
      {
        field: 'phoneBound',
        labelKey: 'Binding cell phone',
        helperKey: 'Recommended for account recovery and high-value payments.',
        onKey: 'Bound',
        offKey: 'Bind cell phone',
      },
      {
        field: 'emailBound',
        labelKey: 'Binding email',
        helperKey: 'Used for login recovery and security notices.',
        onKey: 'Bound',
        offKey: 'Bind email',
      },
      {
        field: 'loginPasswordSet',
        labelKey: 'Set login password',
        helperKey: 'Protect this account when signing in on a new device.',
        onKey: 'Set',
        offKey: 'Set password',
      },
      {
        field: 'paymentPasswordSet',
        labelKey: 'Set payment password',
        helperKey: 'Add a second check before diamond purchases.',
        onKey: 'Set',
        offKey: 'Set password',
      },
      {
        field: 'deviceAlerts',
        labelKey: 'Devices Logged In',
        helperKey: 'Show alerts when a new device logs in.',
        onKey: 'Alerts on',
        offKey: 'Alerts off',
      },
    ]

    return (
      <div className="buzzcast-security-panel">
        <div className="buzzcast-settings-list">
          {accountRows.map((item) => (
            <button
              type="button"
              key={item.field}
              onClick={() => {
                if (item.field === 'deviceAlerts') {
                  updateSettings(item.field, !settingsDraft[item.field], t('Device login alerts updated.'))
                  return
                }
                openSecurityAction(item.field)
              }}
            >
              <span><strong>{t(item.labelKey)}</strong><small>{t(item.helperKey)}</small></span>
              <em>{settingsDraft[item.field] ? t(item.onKey) : t(item.offKey)}</em>
            </button>
          ))}
        </div>
      </div>
    )
  }

  function renderSettings() {
    const activeSettingsItem = settingsNav.find((item) => item.value === activeSettings) || settingsNav[0]

    return (
      <section className="buzzcast-settings-shell">
        <aside className="buzzcast-settings-nav">
          {settingsNav.map((item) => (
            <button
              key={item.value}
              type="button"
              className={activeSettings === item.value ? 'active' : ''}
              onClick={() => {
                setActiveSettings(item.value)
                setSettingsStatus('')
                setSelectedPolicyId('')
              }}
            >
              <i>{item.icon}</i>
              <span>{t(item.labelKey)}</span>
              <b>&gt;</b>
            </button>
          ))}
        </aside>
        <div className="buzzcast-settings-content">
          <div className="buzzcast-settings-heading">
            <h2>{t(activeSettingsItem.labelKey)}</h2>
            <p>{settingsStatus || t('Changes are applied immediately for this session.')}</p>
          </div>
          {renderSettingsContent()}
        </div>
      </section>
    )
  }

  function renderSecurityActionModal() {
    if (!securityAction) return null

    const titleByAction = {
      phoneBound: 'Binding cell phone',
      emailBound: 'Binding email',
      loginPasswordSet: 'Set login password',
      paymentPasswordSet: 'Set payment password',
    }

    return (
      <div className="buzzcast-modal-backdrop dark" onMouseDown={() => setSecurityAction(null)}>
        <form className="buzzcast-security-modal" onSubmit={submitSecurityAction} onMouseDown={(event) => event.stopPropagation()}>
          <header>
            <h2>{t(titleByAction[securityAction])}</h2>
            <button type="button" onClick={() => setSecurityAction(null)}>x</button>
          </header>

          {securityAction === 'phoneBound' ? (
            <label>
              <span>{t('Cell phone number')}</span>
              <input
                value={securityForm.phone}
                onChange={(event) => updateSecurityForm('phone', event.target.value)}
                inputMode="tel"
                placeholder="+1 555 010 2020"
              />
            </label>
          ) : null}

          {securityAction === 'emailBound' ? (
            <label>
              <span>{t('Email address')}</span>
              <input
                type="email"
                value={securityForm.email}
                onChange={(event) => updateSecurityForm('email', event.target.value)}
                placeholder="name@example.com"
              />
            </label>
          ) : null}

          {securityAction === 'loginPasswordSet' ? (
            <>
              <label>
                <span>{t('New password')}</span>
                <input
                  type="password"
                  value={securityForm.password}
                  onChange={(event) => updateSecurityForm('password', event.target.value)}
                  placeholder="10+ characters"
                />
              </label>
              <label>
                <span>{t('Confirm password')}</span>
                <input
                  type="password"
                  value={securityForm.passwordConfirm}
                  onChange={(event) => updateSecurityForm('passwordConfirm', event.target.value)}
                />
              </label>
            </>
          ) : null}

          {securityAction === 'paymentPasswordSet' ? (
            <>
              <label>
                <span>{t('Payment PIN')}</span>
                <input
                  value={securityForm.paymentPin}
                  onChange={(event) => updateSecurityForm('paymentPin', event.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="123456"
                />
              </label>
              <label>
                <span>{t('Confirm PIN')}</span>
                <input
                  value={securityForm.paymentPinConfirm}
                  onChange={(event) => updateSecurityForm('paymentPinConfirm', event.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  maxLength={6}
                />
              </label>
            </>
          ) : null}

          {securityError ? <p className="buzzcast-security-error">{securityError}</p> : null}
          <div className="buzzcast-security-actions">
            <button type="button" onClick={() => setSecurityAction(null)}>{t('Cancel')}</button>
            <button type="submit" className="buzzcast-submit">{t('Save')}</button>
          </div>
        </form>
      </div>
    )
  }

  function renderHelp() {
    return (
      <section className="buzzcast-help-shell">
        <header>
          <h1>Feedback and Help</h1>
          <div className="buzzcast-help-actions">
            <button type="button" className={helpMode === 'records' ? 'active' : ''} onClick={() => setHelpMode('records')}>Feedback record</button>
            <button type="button" className="primary" onClick={() => setShowFeedback(true)}>Submit feedback</button>
          </div>
        </header>
        <div className="buzzcast-help-layout">
          <aside className="buzzcast-help-menu">
            <button type="button" className={helpMode === 'popular' ? 'active' : ''} onClick={() => setHelpMode('popular')}>Popular Questions</button>
            {popularHelp.map((item) => (
              <button
                key={item.id}
                type="button"
                className={helpMode === 'popular' && activeHelp === item.id ? 'active soft' : ''}
                onClick={() => {
                  setHelpMode('popular')
                  setActiveHelp(item.id)
                }}
              >
                {item.title}
              </button>
            ))}
            <button type="button" className={helpMode === 'faq' ? 'active' : ''} onClick={() => setHelpMode('faq')}>Frequently Asked Question</button>
          </aside>
          <main className="buzzcast-help-content">
            {helpMode === 'records' ? (
              <div className="buzzcast-feedback-record-list">
                {feedbackRecords.length ? feedbackRecords.map((record) => (
                  <article key={record.id} className="buzzcast-feedback-record">
                    <div>
                      <strong>{record.category} - {record.type}</strong>
                      <time>{formatFeedbackRecordDate(record.created_at)}</time>
                    </div>
                    <p>{record.description}</p>
                    <small>
                      {record.contact || 'No contact provided'}
                      {record.attachment ? ` - ${record.attachment.name}` : ''}
                    </small>
                  </article>
                )) : (
                  <div className="buzzcast-feedback-empty">
                    <strong>No feedback records yet</strong>
                    <p>Submitted feedback will appear here after it is sent to support.</p>
                    <button type="button" onClick={() => setShowFeedback(true)}>Submit feedback</button>
                  </div>
                )}
              </div>
            ) : helpMode === 'faq' ? (
              <div className="buzzcast-faq-list">
                {faqTopics.map((item) => (
                  <article key={item} className={activeFaq === item ? 'buzzcast-faq-item open' : 'buzzcast-faq-item'}>
                    <button type="button" onClick={() => setActiveFaq(activeFaq === item ? '' : item)}>
                      {item}
                      <span>{activeFaq === item ? '^' : 'v'}</span>
                    </button>
                    {activeFaq === item ? <p>{faqAnswers[item]}</p> : null}
                  </article>
                ))}
              </div>
            ) : (
              <article className="buzzcast-help-answer">
                <h2>{activeHelpItem.title}</h2>
                <p>{activeHelpItem.body}</p>
              </article>
            )}
          </main>
        </div>
      </section>
    )
  }

  function renderRoomPreview() {
    const card = previewCard || demoCards[0]
    const isWarning = card.sensitive && !acceptedWarnings[card.id]
    const previewCover = cardCover(card)
    const previewAvatar = avatarForIndex(cardAvatarIndex(card))

    return (
      <section className="buzzcast-room-preview">
        <div className={`buzzcast-stage media-${card.tone || 'sensitive'}`}>
          <img className="buzzcast-stage-image" src={previewCover} alt="" />
          {isWarning ? (
            <div className="buzzcast-warning-panel">
              <strong>This live broadcast may contain sensitive content</strong>
              <button type="button" onClick={() => setAcceptedWarnings((previous) => ({ ...previous, [card.id]: true }))}>View</button>
              <button type="button" onClick={() => openSettingsSection('content')}>Content Preferences</button>
            </div>
          ) : (
            <>
              <div className="buzzcast-host-pill">
                <span className="image-avatar"><img src={previewAvatar} alt="" loading="lazy" /></span>
                <strong>{card.host}</strong>
                <small>{compactNumber(card.viewers)}</small>
              </div>
              <div className="buzzcast-room-metadata">
                <span>ID:29803275</span>
                <strong>{card.title}</strong>
                <small>{card.country || 'Australia'}</small>
              </div>
              <div className="buzzcast-join-ribbon">21 joined</div>
              <div className="buzzcast-gift-bar">
                {giftCatalog.slice(0, 11).map((gift) => (
                  <button key={gift.id} type="button" title={`${gift.label} - ${gift.cost}`}>
                    <img src={gift.icon} alt="" loading="lazy" />
                    <span>{gift.label}</span>
                    <small>{gift.cost}</small>
                  </button>
                ))}
                <button type="button" onClick={openRechargePanel}>More</button>
                <button type="button" onClick={openRechargePanel}>0</button>
              </div>
            </>
          )}
        </div>
        <aside className="buzzcast-live-chat">
          <p>Be polite and respectful. Any vulgar, violent, or private transaction behavior is strictly prohibited in TalkEachOther. Please speak in a civilized manner.</p>
          <div className="buzzcast-chat-log">
            <span><b>18</b> joined</span>
            <span><b>2</b> joined</span>
          </div>
          <form onSubmit={sendDmMessage}>
            <input value={dmInput} onChange={(event) => setDmInput(event.target.value)} placeholder="Send a chat" />
          </form>
        </aside>
      </section>
    )
  }

  useEffect(() => {
    setSettingsDraft((previous) => ({
      ...previous,
      emailBound: previous.emailBound || Boolean(user?.email),
      region: user?.current_residence || previous.region || 'United States',
    }))
    setFeedbackForm((previous) => ({
      ...previous,
      contact: previous.contact || user?.email || '',
    }))
    setSecurityForm((previous) => ({
      ...previous,
      email: previous.email || user?.email || '',
    }))
  }, [user?.email, user?.current_residence])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('rtc_room_settings', JSON.stringify({
        phoneBound: settingsDraft.phoneBound,
        emailBound: settingsDraft.emailBound,
        loginPasswordSet: settingsDraft.loginPasswordSet,
        paymentPasswordSet: settingsDraft.paymentPasswordSet,
        deviceAlerts: settingsDraft.deviceAlerts,
        messagePrivacy: settingsDraft.messagePrivacy,
        privateInvite: settingsDraft.privateInvite,
        autoPrivateDeduction: settingsDraft.autoPrivateDeduction,
        hideSensitive: settingsDraft.hideSensitive,
        contentMode: settingsDraft.contentMode,
        region: settingsDraft.region,
      }))
    }
    if (typeof document !== 'undefined') {
      document.documentElement.lang = 'en'
    }
  }, [settingsDraft])

  useEffect(() => {
    const timeout = setTimeout(() => {
      loadRooms({
        page: 1,
        searchValue: search,
        filterValue: filter,
        privacyValue: privacyFilter,
        sortValue: sort,
        quiet: true,
      })
    }, search.trim() ? 300 : 0)

    return () => clearTimeout(timeout)
  }, [search, filter, privacyFilter, sort])

  useEffect(() => {
    function handleBeforeInstallPrompt(event) {
      event.preventDefault()
      setInstallPrompt(event)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
  }, [])

  useEffect(() => {
    function handlePopState(event) {
      applySectionFromHistory(event.state || {})
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    if (user) return
    if (activeSection === 'me' || activeSection === 'settings') setActiveSection('live')
    setShowMessages(false)
    setShowRankings(false)
    setShowHostPanel(false)
    setShowRecharge(false)
  }, [activeSection, user])

  return (
    <div className="buzzcast-shell">
      <header className="buzzcast-topbar">
        <BuzzLogo />
        <div className="buzzcast-search-wrap">
          <label className="sr-only" htmlFor="buzzcast-search">Search</label>
          <input
            id="buzzcast-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            onFocus={() => setShowSearchPanel(true)}
            onBlur={() => window.setTimeout(() => setShowSearchPanel(false), 160)}
            placeholder="Search"
          />
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={runSearch} aria-label="Search rooms">
            <span className="buzzcast-search-icon" aria-hidden="true"></span>
          </button>
          {showSearchPanel ? (
            <div className="buzzcast-search-panel">
              <span>{searchPanelTitle}</span>
              {roomSearchResults.map((item, index) => (
                <button
                  key={`${item.type}-${item.id}`}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => openSearchResult(item)}
                >
                  <i className="image-avatar"><img src={avatarForIndex(item.avatarIndex ?? item.id ?? index)} alt="" loading="lazy" /></i>
                  <span><strong>{item.name}</strong><small>{item.detail}</small></span>
                </button>
              ))}
              {!loadingRooms && roomSearchResults.length === 0 ? (
                <em>{search.trim() ? 'Try another room name, host, or room type.' : 'Type a room name, host, or category.'}</em>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="buzzcast-actions">
          {showAdminDashboard ? (
            <IconButton label="Admin dashboard" onClick={() => onView?.('admin')}><i className="buzzcast-glyph glyph-admin" aria-hidden="true"></i></IconButton>
          ) : null}
          <IconButton label="Rankings" onClick={openRankings}><i className="buzzcast-glyph glyph-trophy" aria-hidden="true"></i></IconButton>
          <IconButton label="Messages" badge={unreadThreadCount ? String(unreadThreadCount) : ''} onClick={openMessagesDrawer}><i className="buzzcast-glyph glyph-message" aria-hidden="true"></i></IconButton>
          <IconButton label="Create live room" className="accent" onClick={() => openHostPanel()}>+</IconButton>
          <button type="button" className="buzzcast-avatar-button" onClick={openProfileSection}>
            <span className="image-avatar">
              <img src={avatarForIndex(displayId)} alt={profileInitials} loading="lazy" />
            </span>
          </button>
        </div>
      </header>

      <aside className="buzzcast-left-rail">
        <button type="button" className={activeSection === 'live' || activeSection === 'room' ? 'active' : ''} onClick={openLiveSection}>
          <span className="buzzcast-rail-icon rail-live" aria-hidden="true"></span>
          <b>Live</b>
        </button>
        <button type="button" className={activeSection === 'me' ? 'active' : ''} onClick={openProfileSection}>
          <span className="buzzcast-rail-icon rail-me" aria-hidden="true"></span>
          <b>Me</b>
        </button>
        <div className="buzzcast-rail-spacer"></div>
        <button type="button" onClick={() => setShowInstall(true)}>
          <span className="buzzcast-rail-icon rail-app" aria-hidden="true"></span>
          <b>Get the App</b>
        </button>
        <button type="button" className={activeSection === 'settings' ? 'active' : ''} onClick={() => openSettingsSection()}>
          <span className="buzzcast-rail-icon rail-settings" aria-hidden="true"></span>
          <b>Settings</b>
        </button>
        <button type="button" className={activeSection === 'help' ? 'active' : ''} onClick={() => { pushSectionHistory('help'); setActiveSection('help') }}>
          <span className="buzzcast-rail-icon rail-help" aria-hidden="true"></span>
          <b>Feedback and Help</b>
        </button>
      </aside>

      <main className="buzzcast-main">
        {activeSection === 'live' && renderLiveFeed()}
        {activeSection === 'room' && renderRoomPreview()}
        {activeSection === 'me' && renderProfile()}
        {activeSection === 'settings' && renderSettings()}
        {activeSection === 'help' && renderHelp()}
      </main>

      {showMessages ? (
        <section className="buzzcast-messages-drawer">
          <aside>
            <input placeholder="Search" />
            {messageThreads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                className={activeThread === thread.id ? 'active' : ''}
                onClick={() => {
                  setActiveThread(thread.id)
                  setReadThreadIds((previous) => previous.includes(thread.id) ? previous : [...previous, thread.id])
                  setDmStatus('')
                }}
              >
                <i className="image-avatar"><img src={avatarForIndex(thread.avatarIndex)} alt="" loading="lazy" /></i>
                <span><strong>{thread.name}</strong><small>{followedThreadIds.includes(thread.id) ? 'Following - ' : ''}{thread.previewText}</small></span>
                <time>{thread.time}</time>
                {thread.unread ? <em>{thread.unread}</em> : null}
              </button>
            ))}
          </aside>
          <main>
            <header>
              <strong>{activeThreadData.name}</strong>
              <span>( ID: {activeThreadData.peerId})</span>
              <button type="button" className={activeThreadFollowed ? 'following' : 'follow'} onClick={() => toggleThreadFollow(activeThread)}>
                {activeThreadFollowed ? 'Following' : 'Follow'}
              </button>
              <button type="button" onClick={() => setShowMessages(false)}>End session</button>
            </header>
            <div className={activeThreadFollowed ? 'buzzcast-dm-notice open' : 'buzzcast-dm-notice'}>
              {dmStatus || dmNotice}
            </div>
            <div className="buzzcast-dm-body">
              {(dmMessages[activeThread] || []).map((message) => (
                <p key={message.id} className={message.mine ? 'mine' : ''}>{message.body}</p>
              ))}
            </div>
            <form onSubmit={sendDmMessage}>
              <input
                value={dmInput}
                onChange={(event) => setDmInput(event.target.value)}
                placeholder={activeThreadFollowed ? 'Send a chat' : 'Send up to 2 messages, or follow first'}
              />
            </form>
          </main>
        </section>
      ) : null}

      {showRankings ? (
        <div className="buzzcast-modal-backdrop dark" onMouseDown={() => setShowRankings(false)}>
          <section className="buzzcast-rankings-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h2>Rankings</h2>
                <p>Calculated from room viewers, active participants, host activity, and gift value.</p>
              </div>
              <button type="button" onClick={() => setShowRankings(false)}>x</button>
            </header>
            <nav>
              {[
                { value: 'rooms', label: 'Rooms' },
                { value: 'hosts', label: 'Hosts' },
                { value: 'gifts', label: 'Gifts' },
              ].map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={activeRanking === item.value ? 'active' : ''}
                  onClick={() => setActiveRanking(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </nav>
            <div className="buzzcast-ranking-list">
              {rankingRows.map((item, index) => (
                <article key={item.key}>
                  <b>{index + 1}</b>
                  <span className="image-avatar">
                    <img src={item.icon || avatarForIndex(item.avatarIndex || index)} alt="" loading="lazy" />
                  </span>
                  <div>
                    <strong>{item.name}</strong>
                    <small>{item.detail}</small>
                  </div>
                  <em>{compactNumber(item.score)}</em>
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {showInstall ? (
        <div className="buzzcast-modal-backdrop">
          <section className="buzzcast-install-modal">
            <h2>Install app</h2>
            <div>
              <div className="buzzcast-logo-mark image-mark">
                <img src={brandAssets.appIcon} alt="" />
              </div>
              <span><strong>TalkEachOther</strong><small>TalkEachOther RTC</small></span>
            </div>
            <footer>
              <button type="button" className="primary" onClick={handleInstallApp}>Install</button>
              <button type="button" onClick={() => setShowInstall(false)}>Cancel</button>
            </footer>
          </section>
        </div>
      ) : null}

      {showHostPanel ? (
        <div className="buzzcast-modal-backdrop dark" onMouseDown={() => setShowHostPanel(false)}>
          <section className="buzzcast-host-panel" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <h2>Create Live Room</h2>
              <button type="button" onClick={() => setShowHostPanel(false)}>x</button>
            </header>
            <form onSubmit={createRoom}>
              <label>Room Name</label>
              <input value={roomForm.name} onChange={(event) => updateRoomForm('name', event.target.value)} aria-invalid={Boolean(formErrors.name)} />
              {formErrors.name && <small className="form-error">{formErrors.name}</small>}
              <label>Description</label>
              <textarea value={roomForm.description} onChange={(event) => updateRoomForm('description', event.target.value)} rows={3} aria-invalid={Boolean(formErrors.description)} />
              {formErrors.description && <small className="form-error">{formErrors.description}</small>}
              <label>Room Type</label>
              <div className="buzzcast-choice-grid">
                {Object.entries(roomTypeLabels).map(([value, label]) => (
                  <button key={value} type="button" className={roomForm.room_type === value ? 'active' : ''} onClick={() => updateRoomForm('room_type', value)}>{label}</button>
                ))}
              </div>
              <label>Privacy</label>
              <div className="buzzcast-choice-grid">
                {roomPrivacyOptions.map((option) => (
                  <button key={option.value} type="button" className={roomForm.privacy_type === option.value ? 'active' : ''} onClick={() => updateRoomForm('privacy_type', option.value)}>{option.label}</button>
                ))}
              </div>
              {roomForm.privacy_type === 'password' ? (
                <>
                  <label>Password</label>
                  <input type="password" value={roomForm.password} onChange={(event) => updateRoomForm('password', event.target.value)} autoComplete="new-password" aria-invalid={Boolean(formErrors.password)} />
                  {formErrors.password && <small className="form-error">{formErrors.password}</small>}
                </>
              ) : null}
              <div className="buzzcast-host-fields">
                <div>
                  <label>Stage Seats</label>
                  <input type="number" min="1" max="16" value={roomForm.max_mic_count} onChange={(event) => updateRoomForm('max_mic_count', event.target.value)} aria-invalid={Boolean(formErrors.max_mic_count)} />
                </div>
                <div>
                  <label>Theme</label>
                  <select value={roomForm.theme} onChange={(event) => updateRoomForm('theme', event.target.value)}>
                    {themeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="buzzcast-toggle-grid">
                {roomFeatureOptions.map((option) => (
                  <label key={option.field}>
                    <input type="checkbox" checked={Boolean(roomForm[option.field])} onChange={(event) => updateRoomForm(option.field, event.target.checked)} />
                    <span><strong>{option.label}</strong><small>{option.detail}</small></span>
                  </label>
                ))}
              </div>
              <button className="buzzcast-submit" disabled={creating} type="submit">{creating ? 'Creating...' : 'Create Live Room'}</button>
            </form>

            <div className="buzzcast-quick-join">
              <h3>Quick Join</h3>
              <label>RTC Mode</label>
              <div className="buzzcast-choice-grid">
                {rtcModeOptions.map((option) => {
                  const disabled = option.value === 'video' && !selectedRoomSupportsVideo
                  return (
                    <button key={option.value} type="button" className={joinRtcMode === option.value ? 'active' : ''} onClick={() => updateJoinRtcMode(option.value)} disabled={disabled}>
                      {disabled ? 'Unavailable' : option.label}
                    </button>
                  )
                })}
              </div>
              <label>Room ID</label>
              <input value={roomId} onChange={(event) => clearSelectedRoomIfManual(event.target.value)} placeholder="Select room or enter ID" />
              <label>Room Password</label>
              <input type="password" value={joinPassword} onChange={(event) => setJoinPassword(event.target.value)} placeholder="Only needed for locked rooms" autoComplete="current-password" />
              <button className="buzzcast-submit secondary" type="button" onClick={joinSelectedRoom} disabled={!canJoinRoom}>{openingRoom ? 'Opening...' : 'Open RTC Console'}</button>
              {createdRoom ? (
                <button
                  className="buzzcast-submit"
                  type="button"
                  onClick={() => {
                    if (!requireAuth('Log in to open the RTC console.', 'login')) return
                    onEnterRoom(String(createdRoom.id), {
                      password: joinPassword.trim(),
                      room: createdRoom,
                      rtcMode: defaultRtcModeForRoom(createdRoom),
                      autoConnect: true,
                    })
                  }}
                >
                  Open Created Room #{createdRoom.id}
                </button>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {renderSecurityActionModal()}

      {showRecharge ? (
        <div className="buzzcast-modal-backdrop dark" onMouseDown={() => setShowRecharge(false)}>
          <section className="buzzcast-recharge-panel" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <h2>Balance <span>0</span></h2>
              <button type="button" onClick={() => setShowRecharge(false)}>x</button>
            </header>
            <div className="buzzcast-recharge-tabs"><button type="button" className="active">Top-up</button><button type="button">Reseller</button></div>
            {paymentMethods.map((method) => <button type="button" key={method}>{method}<span>v</span></button>)}
            <button type="button" className="buzzcast-recharge-button">Recharge</button>
          </section>
        </div>
      ) : null}

      {showFeedback ? (
        <div className="buzzcast-modal-backdrop dark">
          <form className="buzzcast-feedback-modal" onSubmit={submitFeedback}>
            <header><h2>Feedback</h2><button type="button" onClick={() => setShowFeedback(false)} disabled={submittingFeedback}>x</button></header>
            <div className="buzzcast-feedback-row">
              <select value={feedbackForm.category} onChange={(event) => updateFeedback('category', event.target.value)} disabled={submittingFeedback}>
                {feedbackCategories.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <select value={feedbackForm.type} onChange={(event) => updateFeedback('type', event.target.value)} disabled={submittingFeedback}>
                {feedbackTypes.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>
            <label>Problem description</label>
            <textarea
              placeholder="Please provide as much detail as possible"
              maxLength={1000}
              value={feedbackForm.description}
              onChange={(event) => updateFeedback('description', event.target.value)}
              disabled={submittingFeedback}
            ></textarea>
            <label>Problem screenshot / screen recording <small>(optional)</small></label>
            <div className={`buzzcast-upload-box ${feedbackForm.attachment ? 'has-file' : ''}`}>
              <input id="feedback-attachment" type="file" accept="image/*,video/*" onChange={handleFeedbackAttachment} disabled={submittingFeedback} />
              <label htmlFor="feedback-attachment">
                <strong>{feedbackForm.attachment ? feedbackForm.attachment.name : 'Add screenshot or screen recording'}</strong>
                <small>PNG, JPG, GIF, MP4, or WebM up to 25 MB</small>
              </label>
              {feedbackForm.attachment ? (
                <button type="button" onClick={removeFeedbackAttachment} disabled={submittingFeedback}>Remove</button>
              ) : null}
            </div>
            <label>Contact information <small>(optional)</small></label>
            <input
              placeholder="Enter your email account"
              value={feedbackForm.contact}
              onChange={(event) => updateFeedback('contact', event.target.value)}
              disabled={submittingFeedback}
            />
            {feedbackStatus ? <p className="buzzcast-feedback-status">{feedbackStatus}</p> : null}
            <button type="submit" className="buzzcast-submit" disabled={submittingFeedback}>
              {submittingFeedback ? 'Sending...' : 'Submit'}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  )
}
