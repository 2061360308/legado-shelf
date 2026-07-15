<template>
  <div class="docs-wrapper">
    <div v-if="loading" class="loading">加载 API 文档中...</div>
    <div v-else-if="error" class="error">
      <p>文档加载失败：{{ error }}</p>
      <button @click="retry">重试</button>
    </div>
    <ApiReference v-else-if="config" :configuration="config" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ApiReference } from '@scalar/api-reference';
import '@scalar/api-reference/style.css';
import { getApiDocs } from '@/lib/api';

const loading = ref(true);
const error = ref<string | null>(null);
const config = ref<any>(null);

async function loadDocs() {
  try {
    loading.value = true;
    error.value = null;

    const specData = await getApiDocs();

    if (specData.servers?.[0]?.variables?.SITE_URL) {
      specData.servers[0].variables.SITE_URL.default = window.location.origin
    }

    config.value = {
      theme: 'purple' as const,
      darkMode: true,
      layout: 'modern' as const,
      authentication: {
        preferredSecurityScheme: 'BearerAuth' as const,
        securitySchemes: {
          BearerAuth: {
            token: localStorage.getItem('nov_api_key') || '',
          },
        },
      },
      spec: { content: specData },
    };
  } catch (err: any) {
    error.value = err.message || '未知错误';
  } finally {
    loading.value = false;
  }
}

function retry() {
  loadDocs();
}

onMounted(() => {
  loadDocs();
});
</script>

<style scoped>
/* 样式保持不变 */
.docs-wrapper {
  height: calc(100vh - 56px);
  width: 100%;
  position: relative;
}
.loading,
.error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-size: 1.2rem;
  color: #666;
}
.error button {
  margin-top: 1rem;
  padding: 0.5rem 1.5rem;
  border: none;
  background: #7c3aed;
  color: white;
  border-radius: 6px;
  cursor: pointer;
}
</style>