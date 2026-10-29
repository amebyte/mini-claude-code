<script setup lang="ts">
import type { FilterType } from '../types/todo'

const props = defineProps<{
  modelValue: FilterType
  counts: Record<FilterType, number>
}>()

const emit = defineEmits<{
  'update:modelValue': [value: FilterType]
}>()

const filters: { value: FilterType; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'active', label: '进行中' },
  { value: 'completed', label: '已完成' }
]
</script>

<template>
  <div class="todo-filter" role="tablist" aria-label="任务筛选">
    <button
      v-for="f in filters"
      :key="f.value"
      type="button"
      class="filter-btn"
      :class="{ active: props.modelValue === f.value }"
      role="tab"
      :aria-selected="props.modelValue === f.value"
      @click="emit('update:modelValue', f.value)"
    >
      {{ f.label }}
      <span class="filter-count">{{ counts[f.value] }}</span>
    </button>
  </div>
</template>

<style scoped>
.todo-filter {
  display: inline-flex;
  gap: 6px;
  padding: 4px;
  background: #f1eefb;
  border-radius: 12px;
}

.filter-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: #6f6891;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    color 0.2s ease,
    box-shadow 0.2s ease;
}

.filter-btn:hover {
  color: #4338ca;
}

.filter-btn.active {
  background: #ffffff;
  color: #4338ca;
  box-shadow: 0 3px 10px rgba(99, 102, 241, 0.18);
}

.filter-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: #e3def7;
  color: #6d5fc2;
  font-size: 11px;
  font-weight: 700;
}

.filter-btn.active .filter-count {
  background: #eef2ff;
  color: #4f46e5;
}
</style>
