<template>
  <div class="container">
    <div v-if="error" class="error-box">{{ error }}</div>

    <div class="card">
      <div class="status-row">
        <span class="status-dot" :class="actionRunning ? 'running' : 'idle'"></span>
        <span>{{ actionRunning ? 'Action 运行中' : '空闲' }}</span>
        <button v-if="!actionRunning && files.length" class="btn btn-primary btn-sm" style="margin-left:auto;margin-right:8px" @click="doTrigger" :disabled="triggering">{{ triggering ? '触发中...' : '触发处理' }}</button>
        <button class="btn btn-outline btn-sm" :style="{ marginLeft: (!actionRunning && files.length) ? '0' : 'auto' }" @click="refresh">刷新</button>
      </div>
    </div>

    <div v-if="uploadMsg" :class="['result-box', uploadMsg.type]" v-html="uploadMsg.html"></div>

    <div class="card">
      <div class="card-title">待处理队列</div>
      <table v-if="files.length">
        <thead><tr><th>文件</th><th>大小</th><th>上传时间</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="f in files" :key="f.key">
            <td class="hash-cell">{{ f.key.replace('uploads/', '').replace('.zip', '').slice(0, 16) }}...</td>
            <td>{{ formatSize(f.size) }}</td>
            <td>{{ formatTime(f.uploaded) }}</td>
            <td><button class="btn btn-sm btn-danger" @click="del(f.key)">删除</button></td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty-state">暂无待处理文件</div>
    </div>

    <div class="card">
      <div class="card-title">已归档查询</div>
      <div class="inline-form">
        <input v-model="searchHash" placeholder="输入 64 位内容哈希查询..." maxlength="64" @keydown.enter="lookup">
        <button class="btn btn-primary btn-sm" @click="lookup">查询</button>
      </div>
      <table v-if="archived">
        <thead><tr><th>哈希</th><th>操作</th></tr></thead>
        <tbody>
          <tr>
            <td class="hash-cell">{{ searchHash.slice(0, 16) }}...</td>
            <td><a :href="archived.releaseUrl" target="_blank" class="btn btn-sm btn-primary">查看</a></td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty-state">{{ archiveMsg }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { getQueue, deleteFromQueue, checkNovel, triggerAction } from '@/lib/api'
import { formatSize, formatTime } from '@/lib/utils'

const route = useRoute()
const actionRunning = ref(false)
const files = ref<{ key: string; size: number; uploaded: string }[]>([])
const error = ref('')
const searchHash = ref('')
const archived = ref<any>(null)
const archiveMsg = ref('输入资源哈希可以查询已归档的小说')
const uploadMsg = ref<{ type: string; html: string } | null>(null)
const triggering = ref(false)

async function refresh() {
  error.value = ''
  try {
    const data = await getQueue()
    actionRunning.value = data.actionRunning
    files.value = data.files.sort((a: any, b: any) => new Date(b.uploaded).getTime() - new Date(a.uploaded).getTime())
    if (searchHash.value) lookup()
  } catch (e: any) {
    error.value = '加载失败: ' + e.message
  }
}

async function del(key: string) {
  if (!confirm(`确定删除 ${key}？`)) return
  try {
    await deleteFromQueue(key)
    refresh()
  } catch (e: any) {
    error.value = '删除失败: ' + e.message
    setTimeout(() => error.value = '', 5000)
  }
}

async function doTrigger() {
  triggering.value = true
  try {
    await triggerAction()
    actionRunning.value = true
  } catch (e: any) {
    error.value = '触发失败: ' + e.message
    setTimeout(() => error.value = '', 5000)
  } finally {
    triggering.value = false
  }
}

async function lookup() {
  const h = searchHash.value.trim()
  if (!/^[a-f0-9]{64}$/.test(h)) {
    archiveMsg.value = '请输入 64 位十六进制哈希'
    archived.value = null
    return
  }
  archiveMsg.value = '查询中...'
  try {
    const r = await checkNovel(h)
    if (r.exists) {
      archived.value = r
    } else {
      archived.value = null
      archiveMsg.value = '未找到该小说'
    }
  } catch (e: any) {
    archived.value = null
    archiveMsg.value = '查询失败: ' + e.message
  }
}

onMounted(async () => {
  const h = route.query.hash as string
  if (h) {
    searchHash.value = h
    try {
      const r = await checkNovel(h)
      if (r.exists) {
        uploadMsg.value = { type: 'success', html: `<strong>✓ 上传成功！小说已归档</strong><br><a href="${r.releaseUrl}" target="_blank">查看 Release</a>` }
      } else {
        uploadMsg.value = { type: 'info', html: '<strong>上传成功！</strong><br>点击上方「触发处理」按钮开始处理。' }
      }
    } catch { /* */ }
  }
  refresh()
})
</script>
