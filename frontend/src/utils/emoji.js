const emojiMeaningfulPattern = /(\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|[0-9#*]\uFE0F?\u20E3)/u
const emojiAllowedPattern = /^[\p{Emoji}\u200D\uFE0F\uFE0E\u20E3\u{E0061}-\u{E007F}]+$/u

function splitEmojiList(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean)
}

export const emojiCategories = [
  {
    id: 'smileys',
    label: 'Smileys',
    emojis: splitEmojiList('😀 😃 😄 😁 😆 😅 😂 🤣 🥲 ☺️ 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥸 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🫣 🤗 🫡 🤔 🫢 🤭 🤫 🤥 😶 😐 😑 😬 🫨 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🫠 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕 🤑 🤠'),
  },
  {
    id: 'people',
    label: 'People',
    emojis: splitEmojiList('👋 🤚 🖐️ ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 🖕 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 🫶 👐 🤲 🤝 🙏 ✍️ 💅 🤳 💪 🦾 🦿 🦵 🦶 👂 🦻 👃 🧠 🫀 🫁 🦷 🦴 👀 👁️ 👅 👄 🫦 👶 🧒 👦 👧 🧑 👱 👨 🧔 👩 🧓 👴 👵 🙍 🙎 🙅 🙆 💁 🙋 🧏 🙇 🤦 🤷 🧑‍💻 👨‍💻 👩‍💻 🧑‍🎤 👨‍🎤 👩‍🎤 🧑‍🚀 👨‍🚀 👩‍🚀 🧑‍⚕️ 👨‍⚕️ 👩‍⚕️ 🧑‍🏫 👨‍🏫 👩‍🏫 🧑‍🍳 👨‍🍳 👩‍🍳 🧑‍🎨 👨‍🎨 👩‍🎨 🧑‍✈️ 👨‍✈️ 👩‍✈️ 🧑‍🚒 👨‍🚒 👩‍🚒 👮 🕵️ 💂 🥷 👷 🫅 🤴 👸 👳 👲 🧕 🤵 👰 🤰 🫃 🫄 👼 🎅 🤶 🧑‍🎄 🦸 🦹 🧙 🧚 🧛 🧜 🧝 🧞 🧟'),
  },
  {
    id: 'hearts',
    label: 'Hearts',
    emojis: splitEmojiList('❤️ 🩷 🧡 💛 💚 💙 🩵 💜 🤎 🖤 🩶 🤍 💔 ❤️‍🔥 ❤️‍🩹 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 💌 💋 💯 💢 💥 💫 💦 💨 🕳️ 💬 👁️‍🗨️ 🗨️ 🗯️ 💭 💤'),
  },
  {
    id: 'animals',
    label: 'Animals',
    emojis: splitEmojiList('🐵 🐒 🦍 🦧 🐶 🐕 🦮 🐕‍🦺 🐩 🐺 🦊 🦝 🐱 🐈 🐈‍⬛ 🦁 🐯 🐅 🐆 🐴 🫎 🫏 🐎 🦄 🦓 🦌 🦬 🐮 🐂 🐃 🐄 🐷 🐖 🐗 🐽 🐏 🐑 🐐 🐪 🐫 🦙 🦒 🐘 🦣 🦏 🦛 🐭 🐁 🐀 🐹 🐰 🐇 🐿️ 🦫 🦔 🦇 🐻 🐻‍❄️ 🐨 🐼 🦥 🦦 🦨 🦘 🦡 🐾 🦃 🐔 🐓 🐣 🐤 🐥 🐦 🐧 🕊️ 🦅 🦆 🦢 🦉 🦤 🪶 🦩 🦚 🦜 🪽 🐦‍⬛ 🪿 🐸 🐊 🐢 🦎 🐍 🐲 🐉 🦕 🦖 🐳 🐋 🐬 🦭 🐟 🐠 🐡 🦈 🐙 🐚 🪸 🪼 🐌 🦋 🐛 🐜 🐝 🪲 🐞 🦗 🪳 🕷️ 🕸️ 🦂 🦟 🪰 🪱 🦠'),
  },
  {
    id: 'food',
    label: 'Food',
    emojis: splitEmojiList('🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🫒 🥑 🍆 🥔 🥕 🌽 🌶️ 🫑 🥒 🥬 🥦 🧄 🧅 🍄 🥜 🫘 🌰 🫚 🫛 🍞 🥐 🥖 🫓 🥨 🥯 🥞 🧇 🧀 🍖 🍗 🥩 🥓 🍔 🍟 🍕 🌭 🥪 🌮 🌯 🫔 🥙 🧆 🥚 🍳 🥘 🍲 🫕 🥣 🥗 🍿 🧈 🧂 🥫 🍱 🍘 🍙 🍚 🍛 🍜 🍝 🍠 🍢 🍣 🍤 🍥 🥮 🍡 🥟 🥠 🥡 🦀 🦞 🦐 🦑 🦪 🍦 🍧 🍨 🍩 🍪 🎂 🍰 🧁 🥧 🍫 🍬 🍭 🍮 🍯 🍼 🥛 ☕ 🫖 🍵 🍶 🍾 🍷 🍸 🍹 🍺 🍻 🥂 🥃 🫗 🥤 🧋 🧃 🧉 🧊'),
  },
  {
    id: 'activities',
    label: 'Activities',
    emojis: splitEmojiList('⚽ 🏀 🏈 ⚾ 🥎 🎾 🏐 🏉 🥏 🎱 🪀 🏓 🏸 🏒 🏑 🥍 🏏 🪃 🥅 ⛳ 🪁 🏹 🎣 🤿 🥊 🥋 🎽 🛹 🛼 🛷 ⛸️ 🥌 🎿 ⛷️ 🏂 🪂 🏋️ 🤼 🤸 ⛹️ 🤺 🤾 🏌️ 🏇 🧘 🏄 🏊 🤽 🚣 🧗 🚴 🚵 🎖️ 🏆 🏅 🥇 🥈 🥉 🎗️ 🎫 🎟️ 🎪 🤹 🎭 🩰 🎨 🎬 🎤 🎧 🎼 🎹 🪗 🥁 🪘 🎷 🎺 🪇 🎸 🪕 🎻 🪈 🎲 ♟️ 🎯 🎳 🎮 🎰 🧩'),
  },
  {
    id: 'travel',
    label: 'Travel',
    emojis: splitEmojiList('🚗 🚕 🚙 🚌 🚎 🏎️ 🚓 🚑 🚒 🚐 🛻 🚚 🚛 🚜 🦯 🦽 🦼 🛴 🚲 🛵 🏍️ 🛺 🚨 🚔 🚍 🚘 🚖 🚡 🚠 🚟 🚃 🚋 🚞 🚝 🚄 🚅 🚈 🚂 🚆 🚇 🚊 🚉 ✈️ 🛫 🛬 🛩️ 💺 🛰️ 🚀 🛸 🚁 🛶 ⛵ 🚤 🛥️ 🛳️ ⛴️ 🚢 ⚓ 🛟 🪝 ⛽ 🚧 🚦 🚥 🚏 🗺️ 🗿 🗽 🗼 🏰 🏯 🏟️ 🎡 🎢 🎠 ⛲ ⛱️ 🏖️ 🏝️ 🏜️ 🌋 ⛰️ 🏔️ 🗻 🏕️ ⛺ 🛖 🏠 🏡 🏘️ 🏚️ 🏗️ 🏭 🏢 🏬 🏣 🏤 🏥 🏦 🏨 🏪 🏫 🏩 💒 🏛️ ⛪ 🕌 🛕 🕍 ⛩️ 🕋'),
  },
  {
    id: 'objects',
    label: 'Objects',
    emojis: splitEmojiList('⌚ 📱 📲 💻 ⌨️ 🖥️ 🖨️ 🖱️ 🖲️ 🕹️ 🗜️ 💽 💾 💿 📀 📼 📷 📸 📹 🎥 📽️ 🎞️ 📞 ☎️ 📟 📠 📺 📻 🎙️ 🎚️ 🎛️ 🧭 ⏱️ ⏲️ ⏰ 🕰️ ⌛ ⏳ 📡 🔋 🪫 🔌 💡 🔦 🕯️ 🪔 🧯 🛢️ 💸 💵 💴 💶 💷 🪙 💰 💳 🪪 💎 ⚖️ 🪜 🧰 🪛 🔧 🔨 ⚒️ 🛠️ ⛏️ 🪚 🔩 ⚙️ 🪤 🧱 ⛓️ 🧲 🔫 💣 🧨 🪓 🔪 🗡️ ⚔️ 🛡️ 🚬 ⚰️ 🪦 ⚱️ 🏺 🔮 📿 🧿 🪬 💈 ⚗️ 🔭 🔬 🕳️ 🩹 🩺 🩻 🩼 💊 💉 🩸 🧬 🦠 🧫 🧪 🌡️ 🧹 🪠 🧺 🧻 🚽 🚿 🛁 🪥 🪒 🧴 🧷 🧹 🛎️ 🧳 🔑 🗝️ 🚪 🪑 🛋️ 🛏️ 🛌 🧸 🪆 🖼️ 🪞 🪟 🛍️ 🛒 🎁 🎈 🎏 🎀 🪩 🪅 🎊 🎉'),
  },
  {
    id: 'symbols',
    label: 'Symbols',
    emojis: splitEmojiList('✅ ☑️ ✔️ ❌ ❎ ➕ ➖ ➗ ✖️ 🟰 ♾️ ⁉️ ‼️ ❓ ❔ ❕ ❗ 〰️ 💱 💲 ⚕️ ♻️ ⚜️ 🔱 📛 🔰 ⭕ 🛑 ⛔ 📵 🚫 💯 🔞 📶 📴 🔋 🪫 🔌 ♀️ ♂️ ⚧️ ✳️ ❇️ ✴️ 🆚 🅰️ 🅱️ 🆎 🅾️ 🆑 🆒 🆓 ℹ️ 🆔 Ⓜ️ 🆕 🆖 🆗 🅿️ 🆘 🆙 🈁 🈂️ 🈷️ 🈶 🈯 🉐 🈹 🈚 🈲 🉑 🈸 🈴 🈳 ㊗️ ㊙️ 🈺 🈵 🔴 🟠 🟡 🟢 🔵 🟣 🟤 ⚫ ⚪ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 ⬛ ⬜ ◼️ ◻️ ◾ ◽ ▪️ ▫️ 🔶 🔷 🔸 🔹 🔺 🔻 💠 🔘 🔳 🔲'),
  },
  {
    id: 'nature',
    label: 'Nature',
    emojis: splitEmojiList('🌵 🎄 🌲 🌳 🌴 🪵 🌱 🌿 ☘️ 🍀 🎍 🪴 🎋 🍃 🍂 🍁 🪺 🪹 🍄 🌾 💐 🌷 🌹 🥀 🪻 🌺 🌸 🌼 🌻 🌞 🌝 🌛 🌜 🌚 🌕 🌖 🌗 🌘 🌑 🌒 🌓 🌔 🌙 🌎 🌍 🌏 🪐 💫 ⭐ 🌟 ✨ ⚡ ☄️ 💥 🔥 🌪️ 🌈 ☀️ 🌤️ ⛅ 🌥️ ☁️ 🌦️ 🌧️ ⛈️ 🌩️ 🌨️ ❄️ ☃️ ⛄ 🌬️ 💨 💧 💦 ☔ ☂️ 🌊 🌫️'),
  },
  {
    id: 'flags',
    label: 'Flags',
    emojis: splitEmojiList('🏁 🚩 🎌 🏴 🏳️ 🏳️‍🌈 🏳️‍⚧️ 🏴‍☠️ 🇺🇸 🇨🇦 🇲🇽 🇧🇷 🇦🇷 🇨🇱 🇨🇴 🇵🇪 🇬🇧 🇮🇪 🇫🇷 🇩🇪 🇮🇹 🇪🇸 🇵🇹 🇳🇱 🇧🇪 🇨🇭 🇦🇹 🇸🇪 🇳🇴 🇩🇰 🇫🇮 🇵🇱 🇺🇦 🇬🇷 🇹🇷 🇮🇳 🇵🇰 🇧🇩 🇱🇰 🇳🇵 🇨🇳 🇯🇵 🇰🇷 🇸🇬 🇹🇭 🇻🇳 🇵🇭 🇮🇩 🇲🇾 🇦🇺 🇳🇿 🇿🇦 🇳🇬 🇪🇬 🇰🇪 🇲🇦 🇸🇦 🇦🇪 🇶🇦 🇮🇱'),
  },
]

export const defaultEmojiReactions = ['👍', '❤️', '😂', '🔥', '👏', '🎉', '😍', '😮']

const emojiAliases = new Map([
  ['happy', splitEmojiList('😀 😃 😄 😁 😊 🙂 😍 🥰')],
  ['laugh', splitEmojiList('😂 🤣 😆 😅')],
  ['sad', splitEmojiList('😞 😔 😢 😭 🥺')],
  ['angry', splitEmojiList('😠 😡 🤬')],
  ['love', splitEmojiList('❤️ 🩷 💕 💖 😍 🥰 😘')],
  ['heart', splitEmojiList('❤️ 🩷 🧡 💛 💚 💙 🩵 💜 🖤 🤍')],
  ['fire', splitEmojiList('🔥 ❤️‍🔥 💥')],
  ['party', splitEmojiList('🎉 🎊 🥳 🎈 🎁')],
  ['ok', splitEmojiList('👌 ✅ ✔️ 👍')],
  ['yes', splitEmojiList('✅ ✔️ 👍 🙌')],
  ['no', splitEmojiList('❌ 🚫 👎')],
  ['star', splitEmojiList('⭐ 🌟 ✨ 🤩')],
  ['music', splitEmojiList('🎤 🎧 🎼 🎹 🎸 🎻 🥁')],
  ['food', emojiCategories.find((category) => category.id === 'food')?.emojis || []],
  ['flag', emojiCategories.find((category) => category.id === 'flags')?.emojis || []],
])

function emojiMatchesSearch(emoji, term) {
  for (const [alias, emojis] of emojiAliases.entries()) {
    if (alias.includes(term) && emojis.includes(emoji)) return true
  }

  return false
}

export function isValidEmoji(value) {
  const emoji = String(value || '').trim()
  return emoji.length > 0
    && emoji.length <= 32
    && emojiAllowedPattern.test(emoji)
    && emojiMeaningfulPattern.test(emoji)
}

export function searchEmojiCategories(query) {
  const term = String(query || '').trim().toLowerCase()
  if (!term) return emojiCategories

  return emojiCategories
    .map((category) => ({
      ...category,
      emojis: category.label.toLowerCase().includes(term)
        ? category.emojis
        : category.emojis.filter((emoji) => emojiMatchesSearch(emoji, term)),
    }))
    .filter((category) => category.emojis.length > 0)
}
