import {
  AudioLines,
  FolderOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
} from "lucide-react";

export function Sidebar({
  collapsed,
  onToggle,
  onMeetings,
  onUpload,
  onSettings,
  isLibrary,
}: {
  collapsed: boolean;
  onToggle: () => void;
  onMeetings: () => void;
  onUpload: () => void;
  onSettings: () => void;
  isLibrary: boolean;
}) {
  return (
    <aside className="sidebar clean-sidebar" aria-label="Main navigation">
      <div className="sidebar-brand-row">
        <button
          className="brand"
          aria-label="Minutes home"
          title="Minutes home"
          onClick={onMeetings}
        >
          <span className="brand-icon">
            <AudioLines size={24} />
          </span>
          <span className="brand-wordmark">minutes.</span>
        </button>
      </div>
      <button
        className="sidebar-toggle"
        onClick={onToggle}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-expanded={!collapsed}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
      </button>
      <nav className="sidebar-navigation" aria-label="Workspace">
        <button
          className="sidebar-nav-item active"
          aria-current={isLibrary ? "page" : undefined}
          title="All meetings"
          onClick={onMeetings}
        >
          <FolderOpen size={20} />
          <span className="sidebar-label">All meetings</span>
        </button>
        <button
          className="sidebar-nav-item"
          title="Upload transcript"
          aria-label="Upload transcript"
          onClick={onUpload}
        >
          <Plus size={20} />
          <span className="sidebar-label">Upload transcript</span>
        </button>
      </nav>
      <div className="sidebar-account">
        <span className="avatar">P</span>
        <div className="sidebar-label">
          <strong>Personal workspace</strong>
          <small>Meeting intelligence</small>
        </div>
      </div>
      <div className="sidebar-bottom-tools">
        <button
          className="sidebar-nav-item"
          aria-label="Settings"
          title="Settings"
          onClick={onSettings}
        >
          <Settings size={20} />
          <span className="sidebar-label">Settings</span>
        </button>
      </div>
    </aside>
  );
}
