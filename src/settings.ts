import { App, PluginSettingTab, Setting } from "obsidian";
import type TickPlugin from "./main";

export interface TickSettings {
  tasksPath: string;
}

export const DEFAULT_SETTINGS: TickSettings = {
  // .tick (dot-prefixed) keeps the data file out of Obsidian's default file
  // browser so users can't poke at the format by mistake.
  tasksPath: ".tick/tasks.md",
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
      .setDesc("Path to tasks.md inside the vault (e.g. .tick/tasks.md)")
      .addText((text) =>
        text
          .setPlaceholder(".tick/tasks.md")
          .setValue(this.plugin.settings.tasksPath)
          .onChange(async (value) => {
            this.plugin.settings.tasksPath = value.trim() || DEFAULT_SETTINGS.tasksPath;
            await this.plugin.saveSettings();
          })
      );
  }
}
