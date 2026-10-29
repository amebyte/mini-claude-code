import { ref, watch } from 'vue'
import type { Todo, FilterType } from '../types/todo'

const STORAGE_KEY = 'vue-todo-app:list'

function loadTodos(): Todo[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Todo[]) : []
  } catch {
    return []
  }
}

export function useTodos() {
  const todos = ref<Todo[]>(loadTodos())
  const filter = ref<FilterType>('all')

  // 自动保存到 localStorage
  watch(
    todos,
    (value) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
      } catch {
        // 忽略存储失败（例如隐私模式）
      }
    },
    { deep: true }
  )

  function addTodo(text: string) {
    const trimmed = text.trim()
    if (!trimmed) return
    todos.value.unshift({
      id: crypto.randomUUID(),
      text: trimmed,
      completed: false,
      createdAt: Date.now()
    })
  }

  function removeTodo(id: string) {
    todos.value = todos.value.filter((todo) => todo.id !== id)
  }

  function toggleTodo(id: string) {
    const todo = todos.value.find((t) => t.id === id)
    if (todo) todo.completed = !todo.completed
  }

  function editTodo(id: string, text: string) {
    const trimmed = text.trim()
    if (!trimmed) {
      removeTodo(id)
      return
    }
    const todo = todos.value.find((t) => t.id === id)
    if (todo) todo.text = trimmed
  }

  function clearCompleted() {
    todos.value = todos.value.filter((todo) => !todo.completed)
  }

  return {
    todos,
    filter,
    addTodo,
    removeTodo,
    toggleTodo,
    editTodo,
    clearCompleted
  }
}
