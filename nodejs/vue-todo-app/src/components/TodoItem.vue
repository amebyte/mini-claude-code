<script setup lang="ts">
import { ref, nextTick } from 'vue'
import type { Todo } from '../types/todo'

const props = defineProps<{
  todo: Todo
}>()

const emit = defineEmits<{
  toggle: [id: string]
  remove: [id: string]
  edit: [id: string, text: string]
}>()

const isEditing = ref(false)
const editText = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

function startEdit() {
  isEditing.value = true
  editText.value = props.todo.text
  nextTick(() => inputRef.value?.focus())
}

function finishEdit() {
  if (!isEditing.value) return
  isEditing.value = false
  emit('edit', props.todo.id, editText.value)
}

function cancelEdit() {
  isEditing.value = false
  editText.value = props.todo.text
}
</script>

<template>
  <li class="todo-item" :class="{ completed: todo.completed }">
    <label class="todo-check">
      <input
        type="checkbox"
        :checked="todo.completed"
        @change="emit('toggle', todo.id)"
      />
      <span class="checkmark" aria-hidden="true"></span>
    </label>

    <div class="todo-body" @dblclick="startEdit">
      <input
        v-if="isEditing"
        ref="inputRef"
        v-model="editText"
        class="todo-edit-input"
        type="text"
        @keyup.enter="finishEdit"
        @keyup.esc="cancelEdit"
        @blur="finishEdit"
      />
      <span v-else class="todo-text">{{ todo.text }}</span>
    </div>

    <button
      class="todo-delete"
      type="button"
      title="删除任务"
      aria-label="删除任务"
      @click="emit('remove', todo.id)"
    >
      ✕
    </button>
  </li>
</template>

<style scoped>
.todo-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  background: #ffffff;
  border: 1px solid #eceaf3;
  border-radius: 14px;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease,
    border-color 0.2s ease,
    background-color 0.2s ease;
}

.todo-item:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 24px rgba(88, 80, 160, 0.14);
  border-color: #d9d4f0;
}

.todo-check {
  position: relative;
  display: inline-flex;
  flex: none;
  cursor: pointer;
}

.todo-check input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.checkmark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 2px solid #c3bddd;
  border-radius: 50%;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease;
}

.checkmark::after {
  content: '';
  width: 6px;
  height: 11px;
  border: solid #ffffff;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg) scale(0);
  transition: transform 0.15s ease;
  margin-top: -2px;
}

.todo-check input:checked + .checkmark {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  border-color: #6366f1;
}

.todo-check input:checked + .checkmark::after {
  transform: rotate(45deg) scale(1);
}

.todo-body {
  flex: 1;
  min-width: 0;
  cursor: text;
}

.todo-text {
  display: block;
  color: #2b2640;
  font-size: 15px;
  line-height: 1.5;
  word-break: break-word;
  transition: color 0.2s ease, opacity 0.2s ease;
}

.completed .todo-text {
  color: #a6a0bd;
  text-decoration: line-through;
}

.todo-edit-input {
  width: 100%;
  padding: 6px 10px;
  font-size: 15px;
  color: #2b2640;
  background: #f7f5fd;
  border: 2px solid #6366f1;
  border-radius: 8px;
  outline: none;
}

.todo-delete {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #b7b0cc;
  font-size: 14px;
  cursor: pointer;
  opacity: 0;
  transition:
    opacity 0.2s ease,
    background-color 0.2s ease,
    color 0.2s ease;
}

.todo-item:hover .todo-delete,
.todo-delete:focus-visible {
  opacity: 1;
}

.todo-delete:hover {
  background: #fee2e2;
  color: #ef4444;
}
</style>
