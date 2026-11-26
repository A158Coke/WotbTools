package com.wotbtools.app

import android.app.AlertDialog
import android.content.Context
import android.content.DialogInterface
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoSession.PromptDelegate

internal class GeckoChoiceDialogs(private val context: Context, private val isClosed: () -> Boolean) {
    private var choiceDialog: AlertDialog? = null

    fun dismiss() { choiceDialog?.dismiss() }

    /**
     * HTML `<select>` 的原生选择菜单（Gecko 把 select 点击转成 choice prompt；默认实现返回 null = 取消，
     * 页面就无法改选）。optgroup 展开为不可选的组标题，disabled 选项不可选。生命周期：页面侧关闭弹窗
     * （导航 / 元素移除）收起对话框并完成 result；弹窗打开期间选项更新时用新 prompt 重绘，结果仍回给同一个 [result]。
     */
    fun showChoicePrompt(
        prompt: PromptDelegate.ChoicePrompt,
        result: GeckoResult<PromptDelegate.PromptResponse>
    ) {
        choiceDialog?.dismiss()
        choiceDialog = null
        if (isClosed()) {
            result.complete(prompt.dismiss())
            return
        }
        var settled = false
        fun settle(response: () -> PromptDelegate.PromptResponse) {
            if (settled) return
            settled = true
            prompt.setDelegate(null)
            result.complete(response())
        }
        val rows = ArrayList<Pair<PromptDelegate.ChoicePrompt.Choice, Int>>()
        fun collect(choices: Array<PromptDelegate.ChoicePrompt.Choice>, depth: Int) {
            for (choice in choices) {
                if (choice.separator) continue
                rows.add(choice to depth)
                choice.items?.let { collect(it, depth + 1) }
            }
        }
        collect(prompt.choices, 0)
        val labels = rows.map { (choice, depth) -> "　".repeat(depth) + choice.label }.toTypedArray()
        fun selectable(index: Int) = rows[index].first.let { !it.disabled && it.items == null }

        val builder = AlertDialog.Builder(context)
        prompt.title?.takeIf { it.isNotBlank() }?.let { builder.setTitle(it) }
        if (prompt.type == PromptDelegate.ChoicePrompt.Type.MULTIPLE) {
            val checked = BooleanArray(rows.size) { rows[it].first.selected }
            builder.setMultiChoiceItems(labels, checked) { dialog, which, isChecked ->
                if (selectable(which)) checked[which] = isChecked
                else (dialog as AlertDialog).listView.setItemChecked(which, checked[which])
            }
            builder.setPositiveButton(android.R.string.ok) { _, _ ->
                settle { prompt.confirm(rows.indices.filter { checked[it] }.map { rows[it].first }.toTypedArray()) }
            }
            builder.setNegativeButton(android.R.string.cancel, null)
        } else {
            val onPick = DialogInterface.OnClickListener { dialog, which ->
                if (!selectable(which)) return@OnClickListener
                settle { prompt.confirm(rows[which].first) }
                dialog.dismiss()
            }
            if (prompt.type == PromptDelegate.ChoicePrompt.Type.MENU) builder.setItems(labels, onPick)
            else builder.setSingleChoiceItems(labels, rows.indexOfFirst { it.first.selected }, onPick)
        }
        val dialog = builder.create()
        // 返回键 / 点外部 / 取消按钮：等价于 select 未改选。
        dialog.setOnDismissListener {
            if (choiceDialog === dialog) choiceDialog = null
            settle { prompt.dismiss() }
        }
        prompt.setDelegate(object : PromptDelegate.PromptInstanceDelegate {
            override fun onPromptDismiss(dismissed: PromptDelegate.BasePrompt) {
                dialog.setOnDismissListener(null)
                if (choiceDialog === dialog) choiceDialog = null
                settle { dismissed.dismiss() }
                dialog.dismiss()
            }

            override fun onPromptUpdate(updatedPrompt: PromptDelegate.BasePrompt) {
                val updated = updatedPrompt as? PromptDelegate.ChoicePrompt
                if (updated != null) {
                    settled = true
                    prompt.setDelegate(null)
                    showChoicePrompt(updated, result)
                } else {
                    dialog.dismiss()
                }
            }
        })
        choiceDialog = dialog
        dialog.show()
    }

}
