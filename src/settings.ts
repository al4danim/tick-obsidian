import { App, PluginSettingTab, Setting } from "obsidian";
import type TickPlugin from "./main";

export interface TickSettings {
  tasksPath: string;
  hideTopFolder: boolean;
  groupByProject: boolean;
  enableSwipe: boolean;
}

export const DEFAULT_SETTINGS: TickSettings = {
  // Plain "tick/" (no dot prefix) — Obsidian Sync silently ignores
  // dot-prefixed folders. Visual hiding is handled by hideTopFolder below.
  tasksPath: "tick/tasks.md",
  hideTopFolder: true,
  groupByProject: true,
  enableSwipe: true,
};

export class TickSettingTab extends PluginSettingTab {
  private plugin: TickPlugin;

  constructor(app: App, plugin: TickPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Tasks file")
      .setDesc("Path to tasks.md inside the vault (e.g. tick/tasks.md)")
      .addText((text) =>
        text
          .setPlaceholder("tick/tasks.md")
          .setValue(this.plugin.settings.tasksPath)
          .onChange(async (value) => {
            this.plugin.settings.tasksPath = value.trim() || DEFAULT_SETTINGS.tasksPath;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Hide tasks folder from file tree")
      .setDesc(
        "Hides the parent folder of tasks.md (e.g. tick/) from Obsidian's file explorer, so you can't accidentally edit the data file. Turn off if you want to see it."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.hideTopFolder).onChange(async (v) => {
          this.plugin.settings.hideTopFolder = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Group pending tasks by project")
      .setDesc("Pending list is grouped by @project (largest groups first; tasks with no project go last). Off = flat list.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.groupByProject).onChange(async (v) => {
          this.plugin.settings.groupByProject = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Swipe row to toggle (mobile)")
      .setDesc("Swipe a task row left or right past the threshold to mark it done / undone. Has no effect on desktop.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.enableSwipe).onChange(async (v) => {
          this.plugin.settings.enableSwipe = v;
          await this.plugin.saveSettings();
        })
      );
  }
}
