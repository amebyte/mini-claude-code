<script setup lang="ts">
import { computed, ref } from 'vue'
import { useTodos } from './composables/useTodos'
import TodoItem from './components/TodoItem.vue'
import TodoFilter from './components/TodoFilter.vue'
import type { FilterType } from './types/todo'

const { todos, filter, addTodo, removeTodo, toggleTodo, editTodo, clearCompleted } =
  useTodos()

const newTodo = ref('')

const filteredTodos = computed(() => {
  switch (filter.value) {
    case 'active':
      return todos.value.filter((t) => !t.completed)
    case 'completed':
      return todos.value.filter((t) => t.completed)
    default:
      return todos.value
  }
})

const stats = computed(() => ({
  total: todos.value.length,
  completed: todos.value.filter((t) => t.completed).length,
  active: todos.value.filter((t) => !t.completed).length
}))

const counts = computed<Record<FilterType, number>>(() => ({
  all: stats.value.total,
  active: stats.value.active,
  completed: stats.value.completed
}))

function handleAdd() {
  if (!newTodo.value.trim()) return
  addTodo(newTodo.value)
  newTodo.value = ''
}

function setFilter(value: FilterType) {
  filter.value = value
}
</script>

<template>
  <div class="page">
    <main class="app-card">
      <header class="app-header">
        <div class="app-icon" aria-hidden="true">✓</div>
        <h1 class="app-title">TodoList</h1>
        <p class="app-subtitle">记录每一天，让任务井然有序</p>
      </header>

      <form class="todo-form" @submit.prevent="handleAdd">
        <input
          v-model="newTodo"
          class="todo-input"
          type="text"
          placeholder="添加一个新任务，回车确认…"
          autocomplete="off"
          maxlength="200"
        />
        <button class="todo-add-btn" type="submit" :disabled="!newTodo.trim()">
          <span class="plus">＋</span> 添加
        </button>
      </form>

      <div class="toolbar">
        <TodoFilter :model-value="filter" :counts="counts" @update:model-value="setFilter" />
        <button
          v-if="stats.completed > 0"
          class="clear-btn"
          type="button"
          @click="clearCompleted"
        >
          清除已完成
        </button>
      </div>

      <TransitionGroup
        name="todo-list"
        tag="ul"
        class="todo-list"
        :class="{ 'is-empty': filteredTodos.length === 0 }"
      >
        <TodoItem
          v-for="todo in filteredTodos"
          :key="todo.id"
          :todo="todo"
          @toggle="toggleTodo"
          @remove="removeTodo"
          @edit="editTodo"
        />
        <li v-if="filteredTodos.length === 0" key="empty" class="empty-state">
          <span class="empty-emoji">🗒️</span>
          <p>这里空空如也</p>
          <p class="empty-hint">
            {{
              filter === 'completed'
                ? '还没有已完成的任务'
                : filter === 'active'
                  ? '没有进行中的任务'
                  : '添加一个任务开始吧'
            }}
          </p>
        </li>
      </TransitionGroup>

      <footer class="app-footer">
        <div class="stats">
          <span class="stat total">总计 <b>{{ stats.total }}</b></span>
          <span class="stat active">进行中 <b>{{ stats.active }}</b></span>
          <span class="stat completed">已完成 <b>{{ stats.completed }}</b></span>
        </div>
      </footer>
    </main>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  box-sizing: border-box;
}

.app-card {
  width: 100%;
  max-width: 560px;
  background: #ffffff;
  border-radius: 24px;
  box-shadow:
    0 24px 60px rgba(59, 40, 140, 0.25),
    0 4px 12px rgba(59, 40, 140, 0.08);
  padding: 32px;
  box-sizing: border-box;
}

.app-header {
  text-align: center;
  margin-bottom: 24px;
}

.app-icon {
  width: 52px;
  height: 52px;
  margin: 0 auto 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  font-weight: 700;
  color: #ffffff;
  background: linear-gradient(135deg, #3b82f6, #8b5cf6);
  border-radius: 16px;
  box-shadow: 0 10px 22px rgba(99, 102, 241, 0.35);
}

.app-title {
  margin: 0;
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.5px;
  color: #221e38;
}

.app-subtitle {
  margin: 6px 0 0;
  font-size: 13px;
  color: #8c86a8;
}

.todo-form {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
}

.todo-input {
  flex: 1;
  min-width: 0;
  padding: 13px 16px;
  font-size: 15px;
  color: #2b2640;
  background: #f7f6fd;
  border: 2px solid #e8e4f5;
  border-radius: 12px;
  outline: none;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    background-color 0.2s ease;
}

.todo-input::placeholder {
  color: #b3adc9;
}

.todo-input:focus {
  border-color: #6366f1;
  background: #ffffff;
  box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.12);
}

.todo-add-btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 20px;
  font-size: 14px;
  font-weight: 700;
  color: #ffffff;
  background: linear-gradient(135deg, #3b82f6, #8b5cf6);
  border: none;
  border-radius: 12px;
  cursor: pointer;
  transition:
    transform 0.15s ease,
    box-shadow 0.2s ease,
    opacity 0.2s ease;
}

.todo-add-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 10px 22px rgba(99, 102, 241, 0.35);
}

.todo-add-btn:active:not(:disabled) {
  transform: translateY(0);
}

.todo-add-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.plus {
  font-size: 16px;
  line-height: 1;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 18px;
  flex-wrap: wrap;
}

.clear-btn {
  padding: 7px 12px;
  font-size: 12px;
  font-weight: 600;
  color: #a358c8;
  background: #f6edfb;
  border: none;
  border-radius: 9px;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    color 0.2s ease;
}

.clear-btn:hover {
  background: #f0ddf7;
  color: #8b2fc9;
}

.todo-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 80px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 36px 16px;
  text-align: center;
}

.empty-emoji {
  font-size: 36px;
}

.empty-state p {
  margin: 0;
  color: #8c86a8;
  font-size: 15px;
  font-weight: 600;
}

.empty-hint {
  font-size: 13px !important;
  font-weight: 400 !important;
  color: #b3adc9 !important;
}

.app-footer {
  margin-top: 24px;
  padding-top: 18px;
  border-top: 1px solid #efecf7;
}

.stats {
  display: flex;
  justify-content: center;
  gap: 26px;
}

.stat {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #8c86a8;
}

.stat b {
  font-size: 15px;
  color: #2b2640;
}

.stat.total b {
  color: #6366f1;
}

.stat.active b {
  color: #3b82f6;
}

.stat.completed b {
  color: #22c55e;
}

/* 列表动画 */
.todo-list-enter-active,
.todo-list-leave-active {
  transition:
    opacity 0.35s ease,
    transform 0.35s ease;
}

.todo-list-enter-from {
  opacity: 0;
  transform: translateY(-12px) scale(0.96);
}

.todo-list-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.96);
}

.todo-list-leave-active {
  position: absolute;
  width: calc(100% - 64px);
}

.todo-list-move {
  transition: transform 0.35s ease;
}

@media (max-width: 520px) {
  .app-card {
    padding: 24px 18px;
    border-radius: 20px;
  }

  .todo-form {
    flex-direction: column;
  }

  .todo-add-btn {
    justify-content: center;
    padding: 12px;
  }

  .stats {
    gap: 16px;
  }
}
</style>
