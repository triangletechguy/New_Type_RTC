import roseIcon from '../assets/rtc/gifts/rose.svg'
import lipstickIcon from '../assets/rtc/gifts/lipstick.svg'
import loveOverflowIcon from '../assets/rtc/gifts/love-overflow.svg'
import melodyIcon from '../assets/rtc/gifts/melody.svg'
import expressionIcon from '../assets/rtc/gifts/expression.svg'
import candyIcon from '../assets/rtc/gifts/candy.svg'
import sweetDateIcon from '../assets/rtc/gifts/sweet-date.svg'
import pawIceCreamIcon from '../assets/rtc/gifts/paw-ice-cream.svg'
import starIcon from '../assets/rtc/gifts/star.svg'
import sparkIcon from '../assets/rtc/gifts/spark.svg'
import colaIcon from '../assets/rtc/gifts/cola.svg'
import racerIcon from '../assets/rtc/gifts/racer.svg'
import sprayIcon from '../assets/rtc/gifts/spray.svg'

export const giftCatalog = [
  { id: 'rose', label: 'Rose', cost: 9, icon: roseIcon },
  { id: 'lipstick', label: 'Lipstick', cost: 99, icon: lipstickIcon },
  { id: 'love-overflow', label: 'Love Overflow', cost: 399, icon: loveOverflowIcon },
  { id: 'melody', label: 'Sweet Melody', cost: 399, icon: melodyIcon },
  { id: 'expression', label: 'Expression', cost: 1, icon: expressionIcon },
  { id: 'candy', label: 'Candy World', cost: 1000, icon: candyIcon },
  { id: 'sweet-date', label: 'Sweet Date', cost: 5999, icon: sweetDateIcon },
  { id: 'paw-ice-cream', label: 'Paw Ice Cream', cost: 1, icon: pawIceCreamIcon },
  { id: 'star', label: 'Star', cost: 5, icon: starIcon },
  { id: 'spark', label: 'Sparklers', cost: 9, icon: sparkIcon },
  { id: 'cola', label: 'Cola', cost: 99, icon: colaIcon },
  { id: 'racer', label: 'Racing Car', cost: 599, icon: racerIcon },
  { id: 'spray', label: 'Spray', cost: 1, icon: sprayIcon },
]

export function giftById(id) {
  return giftCatalog.find((gift) => gift.id === id) || null
}

export function giftIconForId(id) {
  return giftById(id)?.icon || roseIcon
}

export function giftLabelForId(id, fallback = 'Gift') {
  return giftById(id)?.label || fallback
}
