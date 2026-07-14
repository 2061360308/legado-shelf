export const UPLOAD_PREFIX = 'uploads/'
export const HASH_PATTERN = '^[a-f0-9]{64}$'
export const HASH_REGEX = /^[a-f0-9]{64}$/
export const SHORT_HASH_LEN = 12
export const MAX_UPLOAD_SIZE = 52428800

export const DEFAULT_TXT_REGEX_SOURCE = '^[\\s\\u3000]*((?:第[零一二三四五六七八九十百千万\\d]+[章节节卷部回集](?:\\s.*)?)|(?:Chapter\\s+\\d+.*)|(?:序章?|楔子|尾声|番外[一二三四五六七八九十\\d]*|前言|后记|内容简介).*)$'
export const DEFAULT_TXT_REGEX = new RegExp(DEFAULT_TXT_REGEX_SOURCE)
