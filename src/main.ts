import { Plugin, TAbstractFile, normalizePath } from "obsidian";
import { TickSettings, DEFAULT_SETTINGS, TickSettingTab } from "./settings";
import { Store } from "./store";
import { TodayView, VIEW_TYPE_TODAY } from "./today-view";

const HIDE_STYLE_ID = "tick-hide-folder-style";

export default class TickPlugin extends Plugin {
  settings: TickSettings = { ...DEFAULT_SETTINGS };
  store!: Store;
  private hideStyleEl: HTMLStyleElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.store = new Store(this.app, this.settings.tasksPath);

    this.registerView(
      VIEW_TYPE_TODAY,
      (leaf) =>
        new TodayView(leaf, this.store, () => ({
          groupByProject: this.settings.groupByProject,
          enableSwipe: this.settings.enableSwipe,
        }))
    );

    // Auto-refresh open Today views when tasks.md is modified by anyone —
    // covers Obsidian Sync deltas from another device, edits in the markdown
    // editor, and the plugin's own writes (refreshing after our own write
    // is a tiny re-render cost; cheaper than tracking write provenance).
    this.registerEvent(
      this.app.vault.on("modify", (file: TAbstractFile) => {
        if (file.path === normalizePath(this.settings.tasksPath)) {
          this.refreshOpenViews();
        }
      })
    );

    this.addRibbonIcon("check-square", "Tick Today", () => {
      void this.openTodayView();
    });

    this.addCommand({
      id: "tick-add-todo",
      name: "Add todo",
      callback: async () => {
        const view = await this.openTodayView();
        view?.startAdd();
      },
    });

    this.addCommand({
      id: "tick-open-today",
      name: "Open today",
      callback: () => {
        void this.openTodayView();
      },
    });

    this.addSettingTab(new TickSettingTab(this.app, this));

    this.applyHideRule();
  }

  async onunload(): Promise<void> {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_TODAY);
    this.removeHideRule();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.store.setPath(this.settings.tasksPath);
    this.refreshOpenViews();
    this.applyHideRule();
  }

  private async openTodayView(): Promise<TodayView | null> {
    const { workspace } = this.app;

    let leaf = workspace.getLeavesOfType(VIEW_TYPE_TODAY)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE_TODAY, active: true });
    }
    workspace.revealLeaf(leaf);
    const view = leaf.view;
    return view instanceof TodayView ? view : null;
  }

  refreshOpenViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TODAY)) {
      const view = leaf.view;
      if (view instanceof TodayView) {
        void view.refresh();
      }
    }
  }

  // Inject a stylesheet that hides the parent folder of tasksPath from
  // Obsidian's file explorer. Mirrors the visual benefit of the old
  // .tick/ dot-prefix without breaking Obsidian Sync (which ignores dot dirs).
  private applyHideRule(): void {
    this.removeHideRule();
    if (!this.settings.hideTopFolder) return;

    const path = normalizePath(this.settings.tasksPath);
    const slash = path.lastIndexOf("/");
    if (slash <= 0) return; // tasks.md at vault root → nothing to hide
    const dir = path.slice(0, slash);

    // Escape characters that would break a CSS attribute selector.
    const escaped = dir.replace(/["\\]/g, "\\$&");

    const css = `
      .nav-folder:has(> .nav-folder-title[data-path="${escaped}"]) { display: none !important; }
      .nav-folder-title[data-path="${escaped}"] { display: none !important; }
    `;

    const el = document.createElement("style");
    el.id = HIDE_STYLE_ID;
    el.textContent = css;
    document.head.appendChild(el);
    this.hideStyleEl = el;
  }

  private removeHideRule(): void {
    if (this.hideStyleEl) {
      this.hideStyleEl.remove();
      this.hideStyleEl = null;
    }
    // Belt-and-suspenders: catch any leftover from a previous load.
    document.getElementById(HIDE_STYLE_ID)?.remove();
  }
}
