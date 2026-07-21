import { createVNode, render } from 'vue'
import ConfirmDialog from '../ConfirmDialog.vue' 

export function showConfirm(options = {}) {
  if (typeof options === 'string') {
    options = { message: options }
  }

  return new Promise((resolve) => {
    const mountNode = document.createElement('div')
    document.body.appendChild(mountNode)

    const remove = () => {
      render(null, mountNode)
      mountNode.remove()
    }

    const vnode = createVNode(ConfirmDialog, {
      ...options,
      
      // 💡 核心修改：接收 .vue 组件传出来的值 (value)
      onConfirm: (value) => {
        // 1. 如果你在调用时传了 onConfirm 属性，先执行它
        if (options.onConfirm) {
          options.onConfirm(value)
        }
        
        // 2. 核心：让 Promise 吐出真实的数据
        // 如果是输入框模式，resolve 用户输入的文字；否则 resolve true
        resolve(value !== undefined ? value : true)
      },
      
      onCancel: () => {
        if (options.onCancel) options.onCancel()
        resolve(false)
      },
      remove
    })

    render(vnode, mountNode)
  })
}