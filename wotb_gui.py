#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WoT Blitz 回放数据提取工具 — 图形界面 (tkinter, 零额外依赖)

功能:
  - 选择一个或多个 .wotbreplay 文件, 或整个文件夹
  - 一键导出 xlsx (默认生成在回放同目录)
  - 内置结果预览表格 (14 名玩家各项数据)
"""

import os
import sys
import threading
import traceback

import tkinter as tk
from tkinter import ttk, filedialog, messagebox

from wotb_extractor import (
    parse_replay, export_xlsx, load_tankopedia, TEAM_NAME,
    resource_path, collect_battles, export_aggregate_xlsx,
    enrich_display, sort_players, make_platoon_labeler,
    PLAYER_COLUMNS, LEFT_ALIGN_KEYS,
)

# 预览可选的全部列(沿用 Excel 的集中列定义)
AVAILABLE_COLUMNS = PLAYER_COLUMNS
COLUMN_BY_KEY = {c.key: c for c in AVAILABLE_COLUMNS}
# 默认显示的列
DEFAULT_VISIBLE = [
    "nickname", "clan", "tank_name", "tank_type", "survived_label",
    "kills", "damage_dealt", "damage_assisted", "damage_received",
    "damage_blocked", "n_shots", "n_hits_dealt", "n_penetrations_dealt",
    "n_enemies_damaged",
]


class App(ttk.Frame):
    def __init__(self, master):
        super().__init__(master, padding=10)
        self.pack(fill="both", expand=True)
        self.files = []
        self.tankopedia = load_tankopedia()
        self.visible_keys = list(DEFAULT_VISIBLE)   # 当前显示的列(key 列表)
        self.sort_key = None                        # 当前排序列 key
        self.sort_reverse = False
        self._rows = []                             # 当前预览的(已派生)玩家行
        self._build()

    # ---------------- UI ----------------
    def _build(self):
        master = self.master
        master.title("WoT Blitz 回放数据提取工具")
        master.geometry("1020x620")
        master.minsize(820, 480)
        try:
            master.iconbitmap(resource_path("icon.ico"))
        except Exception:
            pass

        # 顶部: 操作按钮
        top = ttk.Frame(self)
        top.pack(fill="x", pady=(0, 8))
        ttk.Button(top, text="选择回放文件…", command=self.pick_files).pack(side="left")
        ttk.Button(top, text="选择文件夹…", command=self.pick_folder).pack(side="left", padx=6)
        ttk.Button(top, text="清空", command=self.clear).pack(side="left")
        ttk.Button(top, text="选择列…", command=self.choose_columns).pack(side="left", padx=6)
        self.merge_btn = ttk.Button(top, text="合并汇总(去重) ▶", command=self.start_merge)
        self.merge_btn.pack(side="right")
        self.export_btn = ttk.Button(top, text="每场单独导出", command=self.start_export)
        self.export_btn.pack(side="right", padx=6)

        # 已选文件计数
        self.count_var = tk.StringVar(value="未选择文件")
        ttk.Label(top, textvariable=self.count_var, foreground="#555").pack(side="right", padx=10)

        # 中部: 左侧文件列表 + 右侧预览表格
        mid = ttk.Panedwindow(self, orient="horizontal")
        mid.pack(fill="both", expand=True)

        left = ttk.Labelframe(mid, text="已选回放", padding=4)
        self.file_list = tk.Listbox(left, activestyle="none")
        self.file_list.pack(side="left", fill="both", expand=True)
        sb = ttk.Scrollbar(left, orient="vertical", command=self.file_list.yview)
        sb.pack(side="right", fill="y")
        self.file_list.config(yscrollcommand=sb.set)
        self.file_list.bind("<<ListboxSelect>>", self.on_select_file)
        mid.add(left, weight=1)

        right = ttk.Labelframe(mid, text="预览 (点击表头可排序；「选择列…」可增减列)", padding=4)
        self.tree = ttk.Treeview(right, show="headings", height=16)
        ysb = ttk.Scrollbar(right, orient="vertical", command=self.tree.yview)
        xsb = ttk.Scrollbar(right, orient="horizontal", command=self.tree.xview)
        self.tree.configure(yscrollcommand=ysb.set, xscrollcommand=xsb.set)
        ysb.pack(side="right", fill="y")
        xsb.pack(side="bottom", fill="x")
        self.tree.pack(side="left", fill="both", expand=True)
        self.tree.tag_configure("t1", background="#DDEBF7")
        self.tree.tag_configure("t2", background="#FCE4D6")
        mid.add(right, weight=3)
        self._rebuild_tree()

        # 底部: 战斗信息 + 日志
        self.info_var = tk.StringVar(value="")
        ttk.Label(self, textvariable=self.info_var, foreground="#1b5e20").pack(fill="x", pady=(8, 2))

        logf = ttk.Labelframe(self, text="日志", padding=4)
        logf.pack(fill="x")
        self.log = tk.Text(logf, height=6, wrap="word", state="disabled",
                           background="#1e1e1e", foreground="#d4d4d4")
        self.log.pack(fill="both", expand=True)

    # ---------------- 文件选择 ----------------
    def pick_files(self):
        paths = filedialog.askopenfilenames(
            title="选择回放文件",
            filetypes=[("WoT Blitz 回放", "*.wotbreplay"), ("所有文件", "*.*")])
        self._add(paths)

    def pick_folder(self):
        d = filedialog.askdirectory(title="选择包含回放的文件夹")
        if d:
            found = [os.path.join(d, f) for f in os.listdir(d)
                     if f.lower().endswith(".wotbreplay")]
            self._add(found)
            if not found:
                self.logmsg(f"该文件夹中没有 .wotbreplay 文件: {d}")

    def _add(self, paths):
        for p in paths:
            if p not in self.files:
                self.files.append(p)
                self.file_list.insert("end", os.path.basename(p))
        self._refresh_count()

    def clear(self):
        self.files.clear()
        self.file_list.delete(0, "end")
        for i in self.tree.get_children():
            self.tree.delete(i)
        self.info_var.set("")
        self._refresh_count()

    def _refresh_count(self):
        n = len(self.files)
        self.count_var.set("未选择文件" if n == 0 else f"已选 {n} 个回放")

    # ---------------- 预览 ----------------
    def on_select_file(self, _event=None):
        sel = self.file_list.curselection()
        if not sel:
            return
        path = self.files[sel[0]]
        try:
            battle, players = parse_replay(path)
        except Exception as e:
            self.logmsg(f"[预览失败] {os.path.basename(path)}: {e}")
            return
        self._fill_preview(battle, players)

    def _fill_preview(self, battle, players):
        # 派生展示字段, 计算排号, 缓存为当前预览行
        platoon_label = make_platoon_labeler()
        rows = []
        for r in sort_players(players):
            row = enrich_display(dict(r), self.tankopedia)
            row["platoon_label"] = platoon_label(r.get("platoon_id"))
            rows.append(row)
        self._rows = rows
        self.sort_key = None          # 默认按 队伍+伤害 (sort_players 的顺序)
        self.sort_reverse = False
        self._populate()
        win = TEAM_NAME.get(battle.get("winner_team"), "平局/未知")
        dur = battle.get("duration_s")
        dur_s = f"{int(dur // 60)}分{int(dur % 60)}秒" if isinstance(dur, (int, float)) else dur
        self.info_var.set(
            f"地图: {battle.get('map_name')}    时长: {dur_s}    "
            f"获胜: {win}    玩家: {len(players)}    版本: {battle.get('version')}")

    # ---------------- 表格列 / 排序 ----------------
    def _rebuild_tree(self):
        """按 self.visible_keys 重建表头(含排序回调)。"""
        keys = self.visible_keys
        self.tree.configure(columns=keys)
        for key in keys:
            col = COLUMN_BY_KEY[key]
            self.tree.heading(key, text=col.title, command=lambda k=key: self.sort_by(k))
            anchor = "w" if key in LEFT_ALIGN_KEYS else "center"
            self.tree.column(key, width=col.px, anchor=anchor, stretch=False)
        self._update_heading_arrows()

    def _update_heading_arrows(self):
        for key in self.visible_keys:
            title = COLUMN_BY_KEY[key].title
            if key == self.sort_key:
                title += " ▼" if self.sort_reverse else " ▲"
            self.tree.heading(key, text=title)

    def sort_by(self, key):
        if self.sort_key == key:
            self.sort_reverse = not self.sort_reverse
        else:
            self.sort_key = key
            self.sort_reverse = False
        self._populate()

    def _populate(self):
        for i in self.tree.get_children():
            self.tree.delete(i)
        rows = self._rows
        if self.sort_key:
            num = COLUMN_BY_KEY[self.sort_key].num

            def keyf(row):
                v = row.get(self.sort_key, "")
                if num:
                    try:
                        return (0, float(v))
                    except (TypeError, ValueError):
                        return (1, 0.0)
                return (0, str(v))

            rows = sorted(rows, key=keyf, reverse=self.sort_reverse)
        for row in rows:
            vals = [row.get(k, "") for k in self.visible_keys]
            tag = "t1" if row.get("team") == 1 else "t2"
            self.tree.insert("", "end", values=vals, tags=(tag,))
        self._update_heading_arrows()

    def choose_columns(self):
        dlg = tk.Toplevel(self)
        dlg.title("选择显示的列")
        dlg.transient(self.master)
        try:
            dlg.iconbitmap(resource_path("icon.ico"))
        except Exception:
            pass
        ttk.Label(dlg, text="勾选要显示的列(顺序固定):", padding=6).pack(anchor="w")
        body = ttk.Frame(dlg, padding=(10, 0))
        body.pack(fill="both", expand=True)
        vars_ = {}
        for idx, col in enumerate(AVAILABLE_COLUMNS):
            v = tk.BooleanVar(value=col.key in self.visible_keys)
            vars_[col.key] = v
            ttk.Checkbutton(body, text=col.title, variable=v).grid(
                row=idx % 11, column=idx // 11, sticky="w", padx=8, pady=2)

        btns = ttk.Frame(dlg, padding=8)
        btns.pack(fill="x")

        def apply_():
            chosen = [c.key for c in AVAILABLE_COLUMNS if vars_[c.key].get()]
            if not chosen:
                messagebox.showinfo("提示", "至少保留一列。", parent=dlg)
                return
            self.visible_keys = chosen
            if self.sort_key not in chosen:
                self.sort_key = None
            self._rebuild_tree()
            self._populate()
            dlg.destroy()

        ttk.Button(btns, text="确定", command=apply_).pack(side="right")
        ttk.Button(btns, text="取消", command=dlg.destroy).pack(side="right", padx=6)
        ttk.Button(btns, text="全选",
                   command=lambda: [v.set(True) for v in vars_.values()]).pack(side="left")
        ttk.Button(btns, text="重置默认",
                   command=lambda: [vars_[k].set(k in DEFAULT_VISIBLE) for k in vars_]
                   ).pack(side="left", padx=6)
        dlg.grab_set()

    # ---------------- 导出 ----------------
    def start_export(self):
        if not self.files:
            messagebox.showinfo("提示", "请先选择回放文件或文件夹。")
            return
        self.export_btn.config(state="disabled")
        threading.Thread(target=self._export_worker, daemon=True).start()

    def _export_worker(self):
        ok = 0
        for path in list(self.files):
            try:
                battle, players = parse_replay(path)
                out = os.path.splitext(path)[0] + ".xlsx"
                export_xlsx(battle, players, self.tankopedia, out)
                self.logmsg(f"[完成] {os.path.basename(out)}  ({len(players)} 名玩家)")
                ok += 1
            except Exception as e:
                self.logmsg(f"[失败] {os.path.basename(path)}: {e}")
                self.logmsg(traceback.format_exc().splitlines()[-1])
        self.logmsg(f"==== 共导出 {ok}/{len(self.files)} 个回放 ====")
        self.after(0, lambda: self.export_btn.config(state="normal"))
        if ok:
            self.after(0, lambda: messagebox.showinfo(
                "完成", f"已导出 {ok} 个回放的 Excel 文件\n(与回放同目录、同名)"))

    def start_merge(self):
        if not self.files:
            messagebox.showinfo("提示", "请先选择回放文件或文件夹。")
            return
        default_dir = os.path.dirname(self.files[0]) if self.files else ""
        out = filedialog.asksaveasfilename(
            title="保存汇总工作簿", initialdir=default_dir,
            initialfile="联赛汇总.xlsx", defaultextension=".xlsx",
            filetypes=[("Excel 工作簿", "*.xlsx")])
        if not out:
            return
        self.merge_btn.config(state="disabled")
        self.export_btn.config(state="disabled")
        threading.Thread(target=self._merge_worker, args=(out,), daemon=True).start()

    def _merge_worker(self, out):
        try:
            battles, dups, fails = collect_battles(list(self.files), on_log=self.logmsg)
            if not battles:
                self.logmsg("没有可用的回放。")
                return
            _, agg = export_aggregate_xlsx(battles, self.tankopedia, out, dups)
            self.logmsg(f"==== 唯一战斗 {len(battles)} | 跳过重复 {len(dups)} | "
                        f"失败 {len(fails)} | 选手 {len(agg)} ====")
            self.logmsg(f"汇总已导出 -> {out}")
            self.after(0, lambda: messagebox.showinfo(
                "完成", f"已合并 {len(battles)} 场战斗 (跳过 {len(dups)} 个重复)\n"
                        f"共 {len(agg)} 名选手\n\n{out}"))
        except Exception as e:
            self.logmsg(f"[汇总失败] {e}")
        finally:
            self.after(0, lambda: (self.merge_btn.config(state="normal"),
                                   self.export_btn.config(state="normal")))

    def logmsg(self, msg):
        def _do():
            self.log.config(state="normal")
            self.log.insert("end", msg + "\n")
            self.log.see("end")
            self.log.config(state="disabled")
        self.after(0, _do)


def main():
    root = tk.Tk()
    try:
        ttk.Style().theme_use("vista")  # Windows 原生风格
    except tk.TclError:
        pass
    app = App(root)
    # 命令行参数 / 拖拽到 exe 上的文件直接载入
    args = [a for a in sys.argv[1:] if a.lower().endswith(".wotbreplay")]
    if args:
        app._add(args)
    root.mainloop()


if __name__ == "__main__":
    main()
