<template>
  <div class="container">
    <div v-if="error" class="error-box">{{ error }}</div>
    <div v-if="status" class="parse-status">{{ status }}</div>

    <!-- Drop zone -->
    <div class="card" v-if="!novel">
      <div class="drop-zone" @dragover.prevent @dragleave="dragOver=false" @drop.prevent="onDrop" @click="fileInput?.click()" :class="{ 'drag-over': dragOver }" @dragenter="dragOver=true">
        <span class="drop-zone-icon">📂</span>
        <p>拖拽小说文件到此处</p>
        <p class="hint">或点击选择文件，支持 .epub / .txt</p>
      </div>
      <input ref="fileInput" type="file" accept=".epub,.txt" style="display:none" @change="onFileChange">
    </div>

    <!-- Split layout after parsing -->
    <div v-if="novel">
      <div class="split-view">
        <div class="split-left">
          <div class="card">
            <div class="card-title">元数据（可编辑）</div>
            <div class="meta-grid">
              <label class="meta-label">书名</label>
              <input v-model="edit.title" class="meta-input" placeholder="书名">
              <label class="meta-label">作者</label>
              <input v-model="edit.author" class="meta-input" placeholder="作者">
              <label class="meta-label">简介</label>
              <textarea v-model="edit.desc" class="meta-textarea" rows="2" placeholder="简介"></textarea>
              <span class="meta-label">封面</span>
              <div class="cover-edit">
                <img v-if="coverUrl" :src="coverUrl" class="cover-preview" alt="封面">
                <div class="cover-actions">
                  <button class="btn btn-sm btn-outline" @click="coverFileInput?.click()">上传图片</button>
                  <input ref="coverFileInput" type="file" accept="image/*" style="display:none" @change="onCoverFile">
                  <span class="cover-or">或</span>
                  <input v-model="coverUrlInput" class="meta-input cover-url" placeholder="输入封面图片 URL">
                  <button class="btn btn-sm btn-outline" @click="loadCoverUrl">加载</button>
                </div>
              </div>
              <span class="meta-label">章节数</span>
              <span class="meta-value">{{ novel.chapters.length }} 章</span>
              <span class="meta-label">资源标识</span>
              <span class="meta-value hash">{{ edit.contentHash }}</span>
            </div>

            <div v-if="novel.sourceFormat === 'txt'" class="regex-section">
              <div class="card-title">TXT 章节拆分规则</div>
              <div class="inline-form">
                <input v-model="regexInput" placeholder="正则表达式" @keydown.enter="reparse">
                <button class="btn btn-primary btn-sm" @click="reparse">重新解析</button>
              </div>
              <p class="hint" style="margin-top:4px">修改后点击"重新解析"应用新的拆分规则</p>
            </div>
          </div>

          <div class="card">
            <div class="card-title">目录（共 {{ novel.chapters.length }} 章）</div>
            <div class="toc-container toc-full">
              <ul>
                <li v-for="(ch, i) in novel.chapters" :key="ch.hash"
                  :class="{ 'toc-active': activeChapter === i }"
                  @click="showChapter(i)">
                  {{ ch.title }}
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div class="split-right">
          <div class="card content-viewer">
            <div class="card-title">{{ viewerTitle }}</div>
            <div class="viewer-body" v-html="viewerHtml"></div>
          </div>
        </div>
      </div>

      <div v-if="uploading" class="progress-wrapper">
        <div class="progress-track"><div class="progress-fill" :style="{ width: progress + '%' }"></div></div>
        <div class="progress-label">{{ progressText }}</div>
      </div>

      <div v-if="uploadResult" v-html="uploadResult" style="margin-top:16px"></div>

      <div class="upload-actions">
        <button class="btn btn-primary btn-lg" :disabled="uploading" @click="startUpload">确认上传</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { parseFile, type NovelData, type ChapterData } from '@/lib/parser'
import { fullUpload } from '@/lib/packer'
import { computeContentHash } from '@/lib/utils'
import { escapeHtml } from '@/lib/utils'
import { DEFAULT_TXT_REGEX_SOURCE } from '@/lib/constants'

const router = useRouter()
const fileInput = ref<HTMLInputElement>()
const coverFileInput = ref<HTMLInputElement>()
const novel = ref<NovelData | null>(null)
const error = ref('')
const status = ref('')
const dragOver = ref(false)
const activeChapter = ref(-1)
const viewerTitle = ref('章节内容')
const viewerHtml = ref('<div class="empty-state">点击左侧目录查看章节内容</div>')
const uploading = ref(false)
const progress = ref(0)
const progressText = ref('')
const uploadResult = ref('')
const coverUrl = ref<string | null>(null)
const coverUrlInput = ref('')
const regexInput = ref(DEFAULT_TXT_REGEX_SOURCE)
let rawFile: File | null = null

const edit = reactive({
  title: '',
  author: '',
  desc: '',
  contentHash: '',
})

function showError(msg: string) { error.value = msg; setTimeout(() => error.value = '', 6000) }

function onDrop(e: DragEvent) {
  dragOver.value = false
  const f = e.dataTransfer?.files?.[0]
  if (f) handleFile(f)
}

function onFileChange() {
  const f = fileInput.value?.files?.[0]
  if (f) handleFile(f)
}

async function handleFile(file: File) {
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (!ext || !['epub', 'txt'].includes(ext)) return showError('不支持的文件格式')
  rawFile = file
  status.value = '正在解析...'
  error.value = ''
  try {
    novel.value = await parseFile(file)
    edit.title = novel.value.title
    edit.author = novel.value.author
    edit.desc = novel.value.description
    edit.contentHash = novel.value.contentHash
    coverUrl.value = novel.value.cover
    activeChapter.value = -1
    viewerTitle.value = '章节内容'
    viewerHtml.value = '<div class="empty-state">点击左侧目录查看章节内容</div>'
    if (novel.value.sourceFormat === 'txt') {
      regexInput.value = DEFAULT_TXT_REGEX_SOURCE
    }
    status.value = ''
  } catch (e: any) {
    status.value = ''
    showError('解析失败: ' + e.message)
  }
}

async function reparse() {
  if (!rawFile || novel.value?.sourceFormat !== 'txt') return
  status.value = '重新解析中...'
  try {
    novel.value = await parseFile(rawFile, { regex: regexInput.value.trim() || undefined })
    edit.title = novel.value.title
    edit.author = novel.value.author
    edit.desc = novel.value.description
    edit.contentHash = novel.value.contentHash
    coverUrl.value = novel.value.cover
    status.value = ''
  } catch (e: any) {
    status.value = ''
    showError('重新解析失败: ' + e.message)
  }
}

function showChapter(i: number) {
  const ch = novel.value!.chapters[i]
  activeChapter.value = i
  viewerTitle.value = ch.title
  viewerHtml.value = `<div class="chapter-content">${escapeHtml(ch.body)}</div>`
}

function onCoverFile() {
  const f = coverFileInput.value?.files?.[0]
  if (!f) return
  if (!f.type.startsWith('image/')) return showError('请选择图片文件')
  const reader = new FileReader()
  reader.onload = () => {
    coverUrl.value = reader.result as string
    if (novel.value) novel.value.cover = coverUrl.value
  }
  reader.readAsDataURL(f)
}

async function loadCoverUrl() {
  const url = coverUrlInput.value.trim()
  if (!url) return
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const blob = await res.blob()
    if (!blob.type.startsWith('image/')) throw new Error('不是图片')
    const buf = await blob.arrayBuffer()
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)))
    const dataUrl = `data:${blob.type};base64,${b64}`
    coverUrl.value = dataUrl
    if (novel.value) novel.value.cover = dataUrl
  } catch (e: any) {
    showError('封面 URL 加载失败: ' + e.message)
  }
}

async function startUpload() {
  if (!novel.value) return
  const n = novel.value
  n.title = edit.title.trim() || n.title
  n.author = edit.author.trim() || n.author
  n.description = edit.desc.trim() || n.description

  if (n.title !== novel.value.title || n.author !== novel.value.author) {
    n.contentHash = await computeContentHash(n.title, n.author, n.chapters.map(c => ({ title: c.title, body: c.body })))
    edit.contentHash = n.contentHash
  }

  uploading.value = true
  progressText.value = '准备中...'
  error.value = ''
  try {
    const r = await fullUpload(n, p => {
      progress.value = Math.round(p * 100)
      progressText.value = `上传中 ${Math.round(p * 100)}%`
    })
    uploading.value = false
    uploadResult.value = `<div class="result-box success"><strong>✓ 上传完成</strong><p>哈希: <code>${escapeHtml(r.hash)}</code></p><a href="/?hash=${escapeHtml(r.hash)}" class="btn btn-primary" @click.prevent="router.push({ path: '/', query: { hash: r.hash } })">返回管理页面</a></div>`
  } catch (e: any) {
    uploading.value = false
    showError('上传失败: ' + e.message)
  }
}
</script>
