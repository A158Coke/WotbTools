package com.wotbtools.app

import android.app.AlertDialog
import android.content.Context
import android.content.DialogInterface
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoSession.PromptDelegate

internal class GeckoChoiceDialogs(private val context: Context, private val isClosed: () -> Boolean) {
    private var choiceDialog: AlertDialog? = null

    fun dismiss() { choiceDialog?.dismiss() }

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
