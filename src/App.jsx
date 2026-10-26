import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Boxes,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  CircleHelp,
  Copy,
  DoorOpen,
  Download,
  FileSpreadsheet,
  Layers,
  LayoutDashboard,
  Menu,
  Package,
  PanelTop,
  Pencil,
  Plus,
  Printer,
  Ruler,
  Scissors,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  X
} from 'lucide-react';
import { createDefaultUnit, createSampleProject } from './data/sampleProject.js';
import {
  buildCutList,
  getDoorCount,
  getProjectStats,
  getProjectWarnings,
  parseNumber,
  summarizeMaterials,
  TYPE_LABELS
} from './lib/engine.js';
import { exportProjectBackup, exportWorkbook, importWorkbook } from './lib/workbook.js';
import { formatDimension, formatNumber } from './lib/format.js';
import { normalizeSavedProject } from './lib/projectStorage.js';

const STORAGE_KEY = 'promax-cabinet-studio-project-v1';

const navigation = [
  {
    label: 'فضای کار',
    items: [
      { id: 'overview', title: 'نمای کلی', icon: LayoutDashboard },
      { id: 'units', title: 'کابینت‌ها', icon: Boxes },
      { id: 'drawers', title: 'کشوها', icon: Layers }
    ]
  },
  {
    label: 'کارگاه',
    items: [
      { id: 'cutlist', title: 'لیست برش', icon: Scissors },
      { id: 'materials', title: 'مصالح و نوار', icon: Package }
    ]
  },
  {
    label: 'راهنما',
    items: [
      { id: 'roadmap', title: 'فرمول‌ها و توسعه', icon: Sparkles }
    ]
  }
];

const pageMeta = {
  overview: ['داشبورد', 'نمای کلی پروژه', 'ابعاد، تعداد قطعات و وضعیت برآورد را یک‌جا ببینید.'],
  units: ['طراحی', 'مدیریت یونیت‌ها', 'کابینت‌های زمینی و هوایی را ویرایش یا به پروژه اضافه کنید.'],
  drawers: ['طراحی', 'محاسبه کشو', 'ابعاد مجموعه کشو و قطعات حاصل از فرمول فایل اصلی.'],
  cutlist: ['تولید', 'لیست برش', 'قطعات بر اساس یونیت، متریال و ابعاد برش.'],
  materials: ['تولید', 'خلاصه متریال', 'مساحت قطعات و متراژ نوار لبه؛ بدون تخمین تعداد ورق خام.'],
  roadmap: ['راهنما', 'فرمول‌ها و توسعه', 'قواعد فعلی، محدودیت‌ها و پیشنهادهای مرحله‌ی بعد.']
};

function loadProject() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      const normalized = normalizeSavedProject(parsed);
      if (normalized) {
        if (normalized.units.length !== parsed.units.length) {
          console.warn('Some invalid saved Pro.Max unit records were skipped while restoring the project.');
        }
        return normalized;
      }
    }
  } catch (error) {
    console.warn('Could not load saved Pro.Max project', error);
  }
  return createSampleProject();
}

function safeCopyUnit(unit) {
  return {
    ...unit,
    parts: unit.parts ? { ...unit.parts } : undefined
  };
}

function iconButtonLabel(type) {
  if (type === 'edit') return 'ویرایش';
  if (type === 'copy') return 'کپی یونیت';
  return 'حذف';
}

function App() {
  const [project, setProject] = useState(loadProject);
  const [activePage, setActivePage] = useState('overview');
  const [unitFilter, setUnitFilter] = useState('all');
  const [unitSearch, setUnitSearch] = useState('');
  const [cutFilter, setCutFilter] = useState('all');
  const [cutSearch, setCutSearch] = useState('');
  const [cutPage, setCutPage] = useState(0);
  const [saveState, setSaveState] = useState('saved');
  const [savedAt, setSavedAt] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [projectDialog, setProjectDialog] = useState(false);
  const [toast, setToast] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef(null);
  const toastTimer = useRef(null);

  const cutList = useMemo(() => buildCutList(project.units || []), [project.units]);
  const stats = useMemo(() => getProjectStats(project.units || [], cutList), [project.units, cutList]);
  const warnings = useMemo(() => getProjectWarnings(project.units || []), [project.units]);

  useEffect(() => {
    setSaveState('saving');
    const timeout = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
        setSaveState('saved');
        setSavedAt(new Date());
      } catch (error) {
        console.error('Could not save Pro.Max project', error);
        setSaveState('error');
      }
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [project]);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const notify = (message, tone = 'success') => {
    setToast({ message, tone });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3600);
  };

  const navigate = (page) => {
    setActivePage(page);
    setMobileOpen(false);
  };

  const updateProject = (updater) => {
    setProject((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater;
      return { ...next, updatedAt: new Date().toISOString() };
    });
  };

  const addUnit = (type = 'lower') => {
    const index = project.units.filter((unit) => unit.type === type).length + 1;
    setDialog({ kind: 'unit', unit: createDefaultUnit(type, index), isNew: true });
  };

  const editUnit = (unit) => setDialog({ kind: 'unit', unit: safeCopyUnit(unit), isNew: false });

  const saveUnit = (savedUnit) => {
    updateProject((current) => {
      const exists = current.units.some((unit) => unit.id === savedUnit.id);
      return {
        ...current,
        units: exists
          ? current.units.map((unit) => unit.id === savedUnit.id ? savedUnit : unit)
          : [...current.units, savedUnit]
      };
    });
    setDialog(null);
    notify(savedUnit.type === 'drawer' ? 'محاسبه کشو ذخیره شد.' : 'یونیت به پروژه اضافه شد.');
  };

  const duplicateUnit = (unit) => {
    const copy = safeCopyUnit(unit);
    copy.id = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `unit-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    copy.name = `${unit.name} — کپی`;
    updateProject((current) => ({ ...current, units: [...current.units, copy] }));
    notify('یک کپی از یونیت ساخته شد.');
  };

  const deleteUnit = (unit) => {
    if (!window.confirm(`«${unit.name}» از پروژه حذف شود؟`)) return;
    updateProject((current) => ({ ...current, units: current.units.filter((item) => item.id !== unit.id) }));
    notify('یونیت حذف شد.', 'info');
  };

  const startNewProject = () => {
    if (!window.confirm('پروژه‌ی جدید ساخته شود؟ پروژه‌ی فعلی در حافظه‌ی محلی باقی نمی‌ماند؛ ابتدا خروجی پشتیبان بگیرید.')) return;
    updateProject({
      id: `project-${Date.now()}`,
      name: 'پروژه جدید',
      customer: '',
      notes: '',
      sourceFile: '',
      createdAt: new Date().toISOString(),
      units: []
    });
    setActivePage('units');
    notify('پروژه‌ی خالی ساخته شد.', 'info');
  };

  const handleImportClick = () => {
    if (!importing) fileInputRef.current?.click();
  };

  const handleImport = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (project.units.length > 0 && !window.confirm('ورود فایل، پروژه‌ی فعلی را جایگزین می‌کند. برای نگه‌داشتن آن ابتدا پشتیبان بگیرید. ادامه می‌دهید؟')) return;
    setImporting(true);
    try {
      const imported = await importWorkbook(file);
      updateProject(imported);
      setActivePage('overview');
      notify(`${imported.units.length} ردیف از فایل «${file.name}» وارد شد.`);
    } catch (error) {
      console.error('Excel import failed', error);
      notify(error?.message || 'خواندن فایل اکسل انجام نشد.', 'error');
    } finally {
      setImporting(false);
    }
  };

  const handleExport = async () => {
    try {
      await exportWorkbook(project);
      notify('فایل Excel لیست برش آماده شد.');
    } catch (error) {
      console.error('Excel export failed', error);
      notify('ساخت فایل Excel انجام نشد.', 'error');
    }
  };

  const handleBackup = () => {
    try {
      exportProjectBackup(project);
      notify('فایل پشتیبان JSON ذخیره شد.');
    } catch (error) {
      console.error('Backup export failed', error);
      notify('ساخت فایل پشتیبان انجام نشد.', 'error');
    }
  };

  const currentMeta = pageMeta[activePage] || pageMeta.overview;

  return (
    <div className="app-shell" dir="rtl" aria-busy={importing}>
      <Sidebar
        activePage={activePage}
        onNavigate={navigate}
        onNewProject={startNewProject}
        onProjectSettings={() => setProjectDialog(true)}
        project={project}
        isOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
      />

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-start">
            <button className="icon-button mobile-menu-button" aria-label="باز کردن منو" onClick={() => setMobileOpen(true)}>
              <Menu size={19} />
            </button>
            <div className="breadcrumb">
              <span>Pro.Max</span>
              <ChevronLeft size={14} />
              <strong>{currentMeta[1]}</strong>
            </div>
          </div>
          <div className="topbar-actions">
            <div className={`save-indicator ${saveState}`} title={savedAt ? `آخرین ذخیره ${savedAt.toLocaleTimeString('fa-IR')}` : 'ذخیره خودکار روی همین دستگاه'}>
              <span className="save-dot" />
              <span>{saveState === 'saving' ? 'در حال ذخیره' : saveState === 'error' ? 'ذخیره نشد' : 'ذخیره خودکار'}</span>
            </div>
            <button className="button button-quiet hide-small" onClick={handleImportClick} disabled={importing}>
              {importing ? <span className="spinner" /> : <Upload size={16} />}
              <span>{importing ? 'در حال خواندن…' : 'ورود از Excel'}</span>
            </button>
            <button className="button button-outline hide-medium" onClick={() => window.print()}>
              <Printer size={16} />
              <span>چاپ / PDF</span>
            </button>
            <button className="button button-primary" onClick={handleExport}>
              <Download size={16} />
              <span>خروجی Excel</span>
            </button>
          </div>
        </header>

        <input ref={fileInputRef} className="visually-hidden" type="file" accept=".xlsx" disabled={importing} onChange={handleImport} />

        <div className="page-scroll">
          {activePage === 'overview' && (
            <OverviewPage
              project={project}
              stats={stats}
              cutList={cutList}
              warnings={warnings}
              onNavigate={navigate}
              onAdd={addUnit}
              onEditProject={() => setProjectDialog(true)}
            />
          )}
          {activePage === 'units' && (
            <UnitsPage
              project={project}
              filter={unitFilter}
              setFilter={setUnitFilter}
              search={unitSearch}
              setSearch={setUnitSearch}
              onAdd={addUnit}
              onEdit={editUnit}
              onDuplicate={duplicateUnit}
              onDelete={deleteUnit}
              onImport={handleImportClick}
            />
          )}
          {activePage === 'drawers' && (
            <DrawersPage
              project={project}
              onAdd={() => addUnit('drawer')}
              onEdit={editUnit}
              onDuplicate={duplicateUnit}
              onDelete={deleteUnit}
              cutList={cutList}
            />
          )}
          {activePage === 'cutlist' && (
            <CutListPage
              cutList={cutList}
              filter={cutFilter}
              setFilter={setCutFilter}
              search={cutSearch}
              setSearch={setCutSearch}
              page={cutPage}
              setPage={setCutPage}
              onExport={handleExport}
            />
          )}
          {activePage === 'materials' && (
            <MaterialsPage project={project} cutList={cutList} stats={stats} onBackup={handleBackup} />
          )}
          {activePage === 'roadmap' && <RoadmapPage project={project} warnings={warnings} />}
        </div>
      </main>

      {dialog?.kind === 'unit' && (
        <UnitDialog
          unit={dialog.unit}
          isNew={dialog.isNew}
          onClose={() => setDialog(null)}
          onSave={saveUnit}
        />
      )}
      {projectDialog && (
        <ProjectDialog
          project={project}
          onClose={() => setProjectDialog(false)}
          onSave={(details) => {
            updateProject((current) => ({ ...current, ...details }));
            setProjectDialog(false);
            notify('مشخصات پروژه ذخیره شد.');
          }}
        />
      )}
      {importing && <div className="import-overlay" role="status" aria-live="polite"><div><span className="spinner" /><span>در حال خواندن فایل و جایگزینی پروژه…</span></div></div>}
      {toast && <div className={`toast toast-${toast.tone}`} role="status">{toast.tone === 'error' ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}{toast.message}</div>}
    </div>
  );
}

function Sidebar({ activePage, onNavigate, onNewProject, onProjectSettings, project, isOpen, onClose }) {
  const lowerCount = project.units.filter((unit) => unit.type === 'lower').length;
  const upperCount = project.units.filter((unit) => unit.type === 'upper').length;
  const drawerCount = project.units.filter((unit) => unit.type === 'drawer').length;

  return (
    <>
      {isOpen && <button className="sidebar-scrim" aria-label="بستن منو" onClick={onClose} />}
      <aside className={`sidebar ${isOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-row">
          <div className="brand-mark"><span>PM</span><i /></div>
          <div className="brand-copy">
            <strong>Pro.Max</strong>
            <span>کابینت استودیو</span>
          </div>
          <button className="icon-button sidebar-close" aria-label="بستن منو" onClick={onClose}><X size={18} /></button>
        </div>

        <button className="workspace-switch" onClick={onProjectSettings}>
          <div className="workspace-avatar">ک</div>
          <div className="workspace-copy"><span>کارگاه شما</span><strong>{project.name || 'پروژه بدون نام'}</strong></div>
          <ChevronDown size={15} />
        </button>

        <div className="sidebar-scroll">
          {navigation.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-group-label">{group.label}</div>
              {group.items.map(({ id, title, icon: Icon }) => {
                const count = id === 'units' ? lowerCount + upperCount : id === 'drawers' ? drawerCount : null;
                return (
                  <button key={id} className={`nav-item ${activePage === id ? 'active' : ''}`} onClick={() => onNavigate(id)}>
                    <Icon size={18} strokeWidth={1.8} />
                    <span>{title}</span>
                    {count !== null && <em>{formatNumber(count, 0)}</em>}
                    {activePage === id && <i className="nav-active-indicator" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="sidebar-bottom">
          <div className="offline-note"><span className="offline-dot" /><span>ذخیره‌شده روی همین دستگاه</span></div>
          <button className="new-project-button" onClick={onNewProject}><Plus size={17} /><span>پروژه‌ی جدید</span></button>
          <div className="sidebar-user">
            <div className="user-avatar">PM</div>
            <div className="user-copy"><strong>کارگاه Pro.Max</strong><span>نسخه‌ی دسکتاپ</span></div>
            <button className="icon-button" aria-label="تنظیمات پروژه" onClick={onProjectSettings}><Settings size={17} /></button>
          </div>
        </div>
      </aside>
    </>
  );
}

function PageHeader({ eyebrow, title, description, children }) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children && <div className="page-heading-actions">{children}</div>}
    </div>
  );
}

function OverviewPage({ project, stats, cutList, warnings, onNavigate, onAdd, onEditProject }) {
  const lowerPercent = stats.unitCount ? (stats.lowerCount / stats.unitCount) * 100 : 0;
  const upperPercent = stats.unitCount ? (stats.upperCount / stats.unitCount) * 100 : 0;
  const materialSummary = summarizeMaterials(cutList);
  const recentUnits = [...project.units].slice(-5).reverse();

  return (
    <div className="content-wrap">
      <PageHeader eyebrow="پیشخوان کارگاه" title="نمای کلی پروژه" description="یک نمای سریع از یونیت‌ها و خروجی ساخت؛ محاسبات طبق قواعد فایل اکسل." >
        <button className="button button-outline" onClick={onEditProject}><Pencil size={15} /> مشخصات پروژه</button>
        <button className="button button-primary" onClick={() => onAdd('lower')}><Plus size={17} /> یونیت جدید</button>
      </PageHeader>

      <section className="project-hero">
        <div className="hero-copy">
          <div className="hero-kicker"><span className="hero-kicker-dot" /> پروژه‌ی فعال</div>
          <h2>{project.name || 'پروژه بدون نام'}</h2>
          <p>{project.customer ? `مشتری: ${project.customer}` : 'طراحی و آماده‌سازی لیست قطعات برای کارگاه'}</p>
          <div className="hero-meta-row">
            <span><FileSpreadsheet size={14} /> {project.sourceFile || 'پروژه‌ی محلی'}</span>
            <span><Ruler size={14} /> ابعاد طبق فایل، با فرض سانتی‌متر</span>
          </div>
          <button className="hero-link" onClick={() => onNavigate('units')}>مدیریت یونیت‌ها <ArrowUpRight size={15} /></button>
        </div>
        <CabinetIllustration lowerCount={stats.lowerCount} upperCount={stats.upperCount} />
      </section>

      <section className="stats-grid" aria-label="خلاصه پروژه">
        <StatCard icon={Boxes} label="یونیت کابینت" value={formatNumber(stats.unitCount, 0)} detail={`${formatNumber(stats.lowerCount, 0)} زمینی · ${formatNumber(stats.upperCount, 0)} هوایی`} tone="teal" />
        <StatCard icon={Scissors} label="قطعات برش" value={formatNumber(stats.pieceCount, 0)} detail="شامل درب و قطعات پشت‌بند" tone="orange" />
        <StatCard icon={Package} label="مساحت قطعات" value={`${formatNumber(stats.areaM2, 2)} m²`} detail={`${formatNumber(stats.materialCount, 0)} گروه متریال`} tone="blue" />
        <StatCard icon={PanelTop} label="نوار لبه" value={`${formatNumber(stats.edgeTapeCm / 100, 2)} m`} detail={`${formatNumber(stats.thinBoard, 0)} قطعه پشت‌بند ۳ میل`} tone="violet" />
      </section>

      <section className="dashboard-grid">
        <div className="card project-composition-card">
          <div className="card-heading">
            <div><span className="card-overline">پیکربندی</span><h3>ترکیب یونیت‌ها</h3></div>
            <button className="text-link" onClick={() => onNavigate('units')}>مشاهده‌ی همه <ChevronLeft size={15} /></button>
          </div>
          {stats.unitCount > 0 ? (
            <div className="composition-content">
              <div className="composition-total"><strong>{formatNumber(stats.unitCount, 0)}</strong><span>یونیت در پروژه</span></div>
              <div className="composition-bar" aria-label="نسبت یونیت زمینی و هوایی">
                <span className="bar-lower" style={{ width: `${lowerPercent}%` }} />
                <span className="bar-upper" style={{ width: `${upperPercent}%` }} />
              </div>
              <div className="composition-legend">
                <div><i className="legend-dot lower" /><span>زمینی</span><strong>{formatNumber(stats.lowerCount, 0)}</strong></div>
                <div><i className="legend-dot upper" /><span>هوایی</span><strong>{formatNumber(stats.upperCount, 0)}</strong></div>
                <div><i className="legend-dot drawer" /><span>مجموعه کشو</span><strong>{formatNumber(stats.drawerCount, 0)}</strong></div>
              </div>
              <div className="composition-footnote"><DoorOpen size={15} /><span>تعداد درب خودکار، با توجه به بازه‌ی عرض تعریف‌شده در Excel محاسبه می‌شود.</span></div>
            </div>
          ) : <EmptyState title="هنوز یونیتی ندارید" detail="یک یونیت اضافه کنید یا فایل اکسل را وارد کنید." actionLabel="افزودن یونیت" onAction={() => onAdd('lower')} />}
        </div>

        <div className="card material-snapshot-card">
          <div className="card-heading">
            <div><span className="card-overline">آماده‌سازی تولید</span><h3>خلاصه‌ی متریال</h3></div>
            <button className="text-link" onClick={() => onNavigate('materials')}>جزئیات <ChevronLeft size={15} /></button>
          </div>
          {materialSummary.length ? (
            <div className="material-snapshot-list">
              {materialSummary.map((item, index) => {
                const maxArea = materialSummary[0]?.areaM2 || 1;
                return (
                  <div className="material-snapshot-row" key={item.material}>
                    <div className={`material-icon material-color-${index % 3}`}><Package size={16} /></div>
                    <div className="material-info"><div><strong>{item.material}</strong><span>{formatNumber(item.pieces, 0)} قطعه</span></div><div className="material-progress"><span style={{ width: `${Math.max(8, item.areaM2 / maxArea * 100)}%` }} /></div></div>
                    <b>{formatNumber(item.areaM2, 2)} <small>m²</small></b>
                  </div>
                );
              })}
              <div className="area-warning"><AlertTriangle size={15} /><span>تعداد ورق خام از روی مساحت تخمین زده نشده؛ ابعاد ورق در فایل منبع مشخص نیست.</span></div>
            </div>
          ) : <div className="empty-inline">بعد از افزودن یونیت، خلاصه‌ی متریال اینجا نمایش داده می‌شود.</div>}
        </div>
      </section>

      <section className="dashboard-grid dashboard-bottom-grid">
        <div className="card recent-units-card">
          <div className="card-heading">
            <div><span className="card-overline">آخرین موارد</span><h3>یونیت‌های پروژه</h3></div>
            <button className="text-link" onClick={() => onNavigate('units')}>رفتن به فهرست <ChevronLeft size={15} /></button>
          </div>
          {recentUnits.length ? (
            <div className="compact-unit-list">
              {recentUnits.map((unit) => <CompactUnitRow key={unit.id} unit={unit} />)}
            </div>
          ) : <EmptyState title="فهرست خالی است" detail="از دکمه‌ی بالا اولین یونیت را بسازید." actionLabel="افزودن یونیت" onAction={() => onAdd('lower')} />}
        </div>

        <div className="card quality-card">
          <div className="card-heading">
            <div><span className="card-overline">کنترل محاسبات</span><h3>یادداشت‌های تولید</h3></div>
            {warnings.length === 0 ? <span className="status-chip status-good"><CheckCircle2 size={14} /> بدون هشدار</span> : <span className="status-chip status-warn"><AlertTriangle size={14} /> {formatNumber(warnings.length, 0)} هشدار</span>}
          </div>
          <div className="quality-note-list">
            {warnings.length > 0 ? warnings.slice(0, 3).map((warning) => <div className="quality-note warning" key={warning.id}><AlertTriangle size={16} /><div><strong>{warning.unitName}</strong><span>{warning.message}</span></div></div>) : (
              <>
                <div className="quality-note"><CheckCircle2 size={16} /><div><strong>ابعاد قابل محاسبه</strong><span>فرمول‌ها بدون مقدار منفی تولید شده‌اند.</span></div></div>
                <div className="quality-note"><Ruler size={16} /><div><strong>واحد اندازه‌گیری</strong><span>فایل واحد را صریح مشخص نکرده؛ این نسخه سانتی‌متر فرض می‌کند.</span></div></div>
                <div className="quality-note"><Scissors size={16} /><div><strong>برش بهینه</strong><span>تیغ اره، رگه‌ی ورق و پرت در این نسخه لحاظ نمی‌شوند.</span></div></div>
              </>
            )}
          </div>
          <button className="quality-footer-link" onClick={() => onNavigate('roadmap')}>مشاهده قواعد و پیشنهادها <ChevronLeft size={15} /></button>
        </div>
      </section>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, detail, tone }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon stat-icon-${tone}`}><Icon size={19} strokeWidth={1.9} /></div>
      <div className="stat-copy"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
      <span className={`stat-accent stat-accent-${tone}`} />
    </div>
  );
}

function CabinetIllustration({ lowerCount, upperCount }) {
  const upperBlocks = Math.min(Math.max(upperCount, 2), 5);
  const lowerBlocks = Math.min(Math.max(lowerCount, 3), 6);
  return (
    <div className="cabinet-illustration" aria-label="نمای شماتیک کابینت‌ها">
      <div className="illustration-label"><span className="illustration-dot" /> نمای شماتیک یونیت‌ها</div>
      <div className="kitchen-scene">
        <div className="scene-upper-row">
          {Array.from({ length: upperBlocks }).map((_, index) => <div className={`scene-upper-unit scene-upper-${index % 3}`} key={`u${index}`}><span /><span /></div>)}
        </div>
        <div className="scene-lamp" />
        <div className="scene-counter" />
        <div className="scene-lower-row">
          {Array.from({ length: lowerBlocks }).map((_, index) => <div className={`scene-lower-unit scene-lower-${index % 3}`} key={`l${index}`}><span className="scene-door" /><span className="scene-handle" />{index === lowerBlocks - 1 && <span className="scene-drawer-front" />}</div>)}
        </div>
        <div className="scene-shadow" />
      </div>
      <div className="illustration-caption"><span>زمینی</span><i /><span>هوایی</span><i /><span>کشو</span></div>
    </div>
  );
}

function EmptyState({ title, detail, actionLabel, onAction }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon"><Boxes size={22} /></div>
      <strong>{title}</strong>
      <span>{detail}</span>
      {actionLabel && onAction && <button className="button button-outline button-small" onClick={onAction}><Plus size={15} />{actionLabel}</button>}
    </div>
  );
}

function CompactUnitRow({ unit }) {
  return (
    <div className="compact-unit-row">
      <div className={`unit-type-icon type-icon-${unit.type}`}>
        {unit.type === 'drawer' ? <Layers size={17} /> : unit.type === 'upper' ? <PanelTop size={17} /> : <Boxes size={17} />}
      </div>
      <div className="compact-unit-name"><strong>{unit.name}</strong><span>{TYPE_LABELS[unit.type]} · {unit.type === 'drawer' ? `${formatNumber(unit.count, 0)} کشو` : `${formatNumber(unit.width, 1)} × ${formatNumber(unit.depth, 1)} × ${formatNumber(unit.height, 1)} cm`}</span></div>
      <ChevronLeft size={16} className="muted-icon" />
    </div>
  );
}

function UnitsPage({ project, filter, setFilter, search, setSearch, onAdd, onEdit, onDuplicate, onDelete, onImport }) {
  const units = project.units.filter((unit) => unit.type !== 'drawer');
  const filteredUnits = units.filter((unit) => {
    const matchesTab = filter === 'all' || unit.type === filter;
    const term = search.trim().toLocaleLowerCase();
    const matchesSearch = !term || `${unit.name} ${TYPE_LABELS[unit.type]}`.toLocaleLowerCase().includes(term);
    return matchesTab && matchesSearch;
  });

  return (
    <div className="content-wrap">
      <PageHeader eyebrow="طراحی پروژه" title="مدیریت یونیت‌ها" description="ابعاد و تعداد قطعات هر یونیت را مطابق روش کارگاه ویرایش کنید.">
        <button className="button button-outline" onClick={onImport}><Upload size={16} /> ورود از Excel</button>
        <button className="button button-primary" onClick={() => onAdd(filter === 'upper' ? 'upper' : 'lower')}><Plus size={17} /> افزودن یونیت</button>
      </PageHeader>

      <div className="filter-toolbar">
        <div className="segmented-control" role="group" aria-label="فیلتر نوع یونیت">
          {[
            ['all', 'همه'],
            ['lower', 'زمینی'],
            ['upper', 'هوایی']
          ].map(([id, label]) => <button key={id} className={filter === id ? 'selected' : ''} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}<span>{formatNumber(id === 'all' ? units.length : units.filter((unit) => unit.type === id).length, 0)}</span></button>)}
        </div>
        <label className="search-field"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="جستجوی نام یونیت..." /></label>
      </div>

      <div className="card table-card">
        <div className="table-card-heading"><div><h3>فهرست یونیت‌ها</h3><span>{formatNumber(filteredUnits.length, 0)} مورد در این فهرست</span></div><div className="table-heading-note"><Ruler size={15} /> واحد اندازه‌گیری: cm</div></div>
        {filteredUnits.length ? (
          <div className="table-scroll">
            <table className="data-table units-table">
              <thead><tr><th>نام یونیت</th><th>نوع</th><th>ابعاد (عرض × عمق × ارتفاع)</th><th>تعداد مشابه</th><th>درب / طبقه</th><th className="actions-col">عملیات</th></tr></thead>
              <tbody>
                {filteredUnits.map((unit) => (
                  <tr key={unit.id}>
                    <td><div className="unit-name-cell"><div className={`unit-type-icon type-icon-${unit.type}`}>{unit.type === 'upper' ? <PanelTop size={17} /> : <Boxes size={17} />}</div><div><strong>{unit.name}</strong><span>{unit.type === 'lower' ? 'کابینت زمینی' : 'کابینت هوایی'}</span></div></div></td>
                    <td><span className={`type-badge type-badge-${unit.type}`}>{TYPE_LABELS[unit.type]}</span></td>
                    <td><span className="dimension-cell" dir="ltr">{formatNumber(unit.width, 1)} × {formatNumber(unit.depth, 1)} × {formatNumber(unit.height, 1)}</span></td>
                    <td>{formatNumber(unit.quantity ?? 1, 0)}</td>
                    <td><span className="small-metric">{formatNumber(getDoorCount(unit), 0)} درب</span><span className="small-metric-sep">·</span><span className="small-metric">{formatNumber(unit.parts?.shelf ?? 0, 0)} طبقه</span></td>
                    <td><UnitActions unit={unit} onEdit={onEdit} onDuplicate={onDuplicate} onDelete={onDelete} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title={search ? 'نتیجه‌ای پیدا نشد' : 'هنوز یونیتی اضافه نشده'} detail={search ? 'نام دیگری را جستجو کنید یا فیلتر را پاک کنید.' : 'یک یونیت بسازید یا داده‌ها را از فایل Excel وارد کنید.'} actionLabel={search ? null : 'افزودن یونیت'} onAction={search ? null : () => onAdd(filter === 'upper' ? 'upper' : 'lower')} />
        )}
      </div>
      <div className="inline-info"><CircleHelp size={16} /><span>تعدادهای پایه و ابعاد از فایل «{project.sourceFile || 'پروژه‌ی فعلی'}» آمده‌اند؛ همه‌ی مقادیر قبل از سفارش برش باید کنترل شوند.</span></div>
    </div>
  );
}

function DrawersPage({ project, onAdd, onEdit, onDuplicate, onDelete, cutList }) {
  const drawerUnits = project.units.filter((unit) => unit.type === 'drawer');
  const drawerParts = cutList.filter((row) => row.type === 'drawer');
  const totalDrawerCount = drawerUnits.reduce((sum, unit) => sum + parseNumber(unit.count, 0), 0);
  return (
    <div className="content-wrap">
      <PageHeader eyebrow="طراحی پروژه" title="محاسبه کشو" description="فرمول ابعاد بدنه، جلو و پشت کشو از شیت «کشو» در فایل اصلی بازسازی شده است.">
        <button className="button button-primary" onClick={onAdd}><Plus size={17} /> افزودن مجموعه کشو</button>
      </PageHeader>

      <div className="drawer-summary-grid">
        <StatCard icon={Layers} label="مجموعه‌های کشو" value={formatNumber(drawerUnits.length, 0)} detail="ردیف‌های محاسبه‌شده" tone="teal" />
        <StatCard icon={Boxes} label="تعداد کشو" value={formatNumber(totalDrawerCount, 0)} detail="بر اساس تعداد واردشده" tone="orange" />
        <StatCard icon={Scissors} label="قطعات کشو" value={formatNumber(drawerParts.reduce((sum, row) => sum + row.quantity, 0), 0)} detail="بدنه، جلو و پشت" tone="blue" />
      </div>

      {drawerUnits.length ? (
        <div className="drawer-card-list">
          {drawerUnits.map((unit) => {
            const sideWidth = parseNumber(unit.height, 0) / 3 - 4;
            return (
              <div className="card drawer-module-card" key={unit.id}>
                <div className="drawer-module-top"><div className="drawer-title-wrap"><div className="unit-type-icon type-icon-drawer"><Layers size={18} /></div><div><h3>{unit.name}</h3><span>محاسبه‌ی مجموعه بر اساس شیت کشو</span></div></div><UnitActions unit={unit} onEdit={onEdit} onDuplicate={onDuplicate} onDelete={onDelete} /></div>
                <div className="drawer-dimensions">
                  <DimensionTile label="تعداد" value={`${formatNumber(unit.count, 0)} کشو`} />
                  <DimensionTile label="عرض مجموعه" value={formatDimension(unit.width)} />
                  <DimensionTile label="عمق" value={formatDimension(unit.depth)} />
                  <DimensionTile label="ارتفاع" value={formatDimension(unit.height)} />
                </div>
                <div className="drawer-formula-result">
                  <div className="formula-caption"><span className="formula-dot" /> ابعاد برش محاسبه‌شده</div>
                  <div className="formula-parts">
                    <div><strong>بدنه کشو</strong><span>{formatNumber(parseNumber(unit.depth, 0) - 5)} × {formatNumber(sideWidth)} cm</span><small>{formatNumber(parseNumber(unit.count, 0) * 2, 0)} قطعه</small></div>
                    <div><strong>جلوی کشو</strong><span>{formatNumber(parseNumber(unit.width, 0) - 9.1)} × {formatNumber(sideWidth)} cm</span><small>{formatNumber(unit.count, 0)} قطعه</small></div>
                    <div><strong>پشت کشو</strong><span>{formatNumber(parseNumber(unit.width, 0) - 9.1)} × {formatNumber(sideWidth - 2)} cm</span><small>{formatNumber(unit.count, 0)} قطعه</small></div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : <div className="card empty-card"><EmptyState title="مجموعه کشویی ثبت نشده" detail="ابعاد را وارد کنید تا اندازه‌ی قطعات به شکل خودکار محاسبه شود." actionLabel="افزودن مجموعه کشو" onAction={onAdd} /></div>}

      <div className="formula-callout"><CircleHelp size={17} /><div><strong>یادداشت فرمول</strong><span>در فایل اصلی قطعه‌ی کف کشو جداگانه تعریف نشده است؛ نسخه‌ی فعلی فقط «بدنه»، «جلو» و «پشت» را محاسبه می‌کند.</span></div></div>
    </div>
  );
}

function DimensionTile({ label, value }) {
  return <div className="dimension-tile"><span>{label}</span><strong>{value}</strong></div>;
}

function UnitActions({ unit, onEdit, onDuplicate, onDelete }) {
  return (
    <div className="unit-actions">
      <button className="icon-button" title={iconButtonLabel('edit')} aria-label={iconButtonLabel('edit')} onClick={() => onEdit(unit)}><Pencil size={15} /></button>
      <button className="icon-button" title={iconButtonLabel('copy')} aria-label={iconButtonLabel('copy')} onClick={() => onDuplicate(unit)}><Copy size={15} /></button>
      <button className="icon-button danger-action" title={iconButtonLabel('delete')} aria-label={iconButtonLabel('delete')} onClick={() => onDelete(unit)}><Trash2 size={15} /></button>
    </div>
  );
}

function CutListPage({ cutList, filter, setFilter, search, setSearch, page, setPage, onExport }) {
  const pageSize = 14;
  const filtered = cutList.filter((row) => {
    const matchesType = filter === 'all' || row.type === filter;
    const term = search.trim().toLocaleLowerCase();
    const matchesSearch = !term || `${row.unitName} ${row.part} ${row.material}`.toLocaleLowerCase().includes(term);
    return matchesType && matchesSearch;
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.max(0, Math.min(page, pageCount - 1));
  useEffect(() => {
    setPage((current) => Math.max(0, Math.min(current, pageCount - 1)));
  }, [pageCount, setPage]);
  const visibleRows = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize);
  const totalPieces = filtered.reduce((sum, row) => sum + row.quantity, 0);
  const totalEdge = filtered.reduce((sum, row) => sum + row.edgeTapeCm, 0) / 100;

  return (
    <div className="content-wrap">
      <PageHeader eyebrow="تولید" title="لیست برش" description="ابعاد برش با واحد سانتی‌متر؛ تعداد هر ردیف پس از اعمال تعداد یونیت محاسبه شده است.">
        <button className="button button-primary" onClick={onExport}><Download size={16} /> خروجی Excel</button>
      </PageHeader>

      <div className="cutlist-metrics">
        <div><span>ردیف‌های برش</span><strong>{formatNumber(filtered.length, 0)}</strong></div>
        <div><span>مجموع قطعات</span><strong>{formatNumber(totalPieces, 0)}</strong></div>
        <div><span>نوار لبه‌ی محاسبه‌شده</span><strong>{formatNumber(totalEdge, 2)} <small>m</small></strong></div>
      </div>

      <div className="card table-card cutlist-table-card">
        <div className="cutlist-toolbar">
          <div className="segmented-control cut-filter" role="group" aria-label="فیلتر لیست برش">
            {[
              ['all', 'همه'], ['lower', 'زمینی'], ['upper', 'هوایی'], ['drawer', 'کشو']
            ].map(([id, label]) => <button key={id} className={filter === id ? 'selected' : ''} aria-pressed={filter === id} onClick={() => { setFilter(id); setPage(0); }}>{label}</button>)}
          </div>
          <label className="search-field"><Search size={17} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="قطعه، متریال یا یونیت..." /></label>
        </div>
        {visibleRows.length ? (
          <div className="table-scroll">
            <table className="data-table cutlist-table">
              <thead><tr><th>شناسه</th><th>یونیت</th><th>قطعه</th><th>متریال</th><th>ابعاد (عرض × طول)</th><th>تعداد</th><th>نوار لبه</th></tr></thead>
              <tbody>
                {visibleRows.map((row, index) => (
                  <tr key={row.id}>
                    <td><span className="table-index">{formatNumber(safePage * pageSize + index + 1, 0)}</span></td>
                    <td><div className="cut-unit"><span className={`mini-type-dot ${row.type}`} /><span>{row.unitName}</span></div></td>
                    <td><strong className="cut-part-name">{row.part}</strong></td>
                    <td><span className="material-pill">{row.material}</span></td>
                    <td><span className="dimension-cell" dir="ltr">{formatNumber(row.width)} × {formatNumber(row.length)} cm</span></td>
                    <td><span className="quantity-pill">{formatNumber(row.quantity, 0)}</span></td>
                    <td>{row.edgeTapeCm > 0 ? <span className="edge-value">{formatNumber(row.edgeTapeCm / 100, 2)} m</span> : <span className="muted-dash">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState title="قطعه‌ای پیدا نشد" detail="فیلتر یا عبارت جستجو را تغییر دهید." />}
        <div className="table-footer"><span>نمایش {formatNumber(filtered.length ? safePage * pageSize + 1 : 0, 0)} تا {formatNumber(Math.min((safePage + 1) * pageSize, filtered.length), 0)} از {formatNumber(filtered.length, 0)} ردیف</span><div className="pagination"><button disabled={safePage <= 0} onClick={() => setPage(Math.max(0, safePage - 1))} aria-label="صفحه قبلی"><ChevronLeft size={16} /></button><span>{formatNumber(safePage + 1, 0)} / {formatNumber(pageCount, 0)}</span><button disabled={safePage + 1 >= pageCount} onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))} aria-label="صفحه بعد"><ChevronLeft size={16} className="flip-icon" /></button></div></div>
      </div>
      <div className="inline-info"><AlertTriangle size={16} /><span>لیست برش از قواعد و مقادیر فایل اکسل بازسازی شده است. ضخامت تیغ اره، جهت رگه، پرت ورق خام و بهینه‌سازی چیدمان در نسخه‌ی فعلی لحاظ نمی‌شود.</span></div>
    </div>
  );
}

function MaterialsPage({ project, cutList, stats, onBackup }) {
  const materials = summarizeMaterials(cutList);
  const maxArea = materials[0]?.areaM2 || 1;
  const mainEdge = cutList.reduce((sum, item) => sum + item.edgeTapeCm, 0) / 100;
  return (
    <div className="content-wrap">
      <PageHeader eyebrow="تولید" title="مصالح و نوار لبه" description="خلاصه‌ی مساحت قطعات؛ برای سفارش ورق، ابعاد ورق خام باید در تنظیمات پروژه تعریف شود.">
        <button className="button button-outline" onClick={onBackup}><Download size={16} /> پشتیبان پروژه</button>
      </PageHeader>

      <section className="material-summary-hero">
        <div className="material-summary-intro"><div className="summary-badge"><Package size={16} /> برآورد ابعادی</div><h2>مواد اولیه‌ی پروژه</h2><p>جمع مساحت از طول × عرض هر قطعه محاسبه می‌شود؛ این مقدار جایگزین بهینه‌سازی واقعی ورق نیست.</p></div>
        <div className="material-kpi"><span>مساحت کل قطعات</span><strong>{formatNumber(stats.areaM2, 2)} <small>m²</small></strong><span>بدون افزودن پرت</span></div>
        <div className="material-kpi"><span>نوار لبه</span><strong>{formatNumber(mainEdge, 2)} <small>m</small></strong><span>طبق پرچم‌های فایل اصلی</span></div>
      </section>

      <section className="materials-grid">
        <div className="card materials-breakdown-card">
          <div className="card-heading"><div><span className="card-overline">تقسیم بر اساس گروه</span><h3>مساحت و تعداد قطعات</h3></div><span className="small-muted">{formatNumber(materials.length, 0)} متریال</span></div>
          {materials.length ? <div className="material-breakdown-list">
            {materials.map((item, index) => (
              <div className="material-breakdown-row" key={item.material}>
                <div className={`material-icon material-color-${index % 3}`}><Package size={17} /></div>
                <div className="material-breakdown-main"><div className="material-breakdown-title"><strong>{item.material}</strong><span>{formatNumber(item.pieces, 0)} قطعه</span></div><div className="material-progress material-progress-large"><span style={{ width: `${Math.max(4, (item.areaM2 / maxArea) * 100)}%` }} /></div></div>
                <div className="material-breakdown-value"><strong>{formatNumber(item.areaM2, 2)} m²</strong><span>{formatNumber(item.lineCount, 0)} ردیف</span></div>
              </div>
            ))}
          </div> : <EmptyState title="داده‌ای برای جمع‌بندی نیست" detail="با افزودن یونیت، ردیف‌های برش اینجا جمع می‌شوند." />}
        </div>

        <div className="material-side-column">
          <div className="card material-note-card">
            <div className="note-card-icon"><Ruler size={19} /></div><h3>برای سفارش ورق چه چیزی کم است؟</h3><p>فایل منبع فقط اندازه‌ی قطعات را دارد و ابعاد ورق خام، ضخامت تیغ و جهت رگه را مشخص نمی‌کند.</p>
            <div className="missing-settings"><span><i /> ابعاد ورق خام</span><span><i /> ضخامت تیغ اره</span><span><i /> حاشیه‌ی پرت</span></div>
            <button className="text-link" onClick={() => window.print()}>چاپ خلاصه <ChevronLeft size={15} /></button>
          </div>
          <div className="card material-source-card">
            <div className="source-card-top"><FileSpreadsheet size={18} /><span>منبع داده</span></div><strong>{project.sourceFile || 'پروژه‌ی محلی'}</strong><span className="source-card-copy">مقادیر واردشده را پیش از تحویل به برش‌کار با فایل/نقشه‌ی نهایی تطبیق دهید.</span>
          </div>
        </div>
      </section>
      <div className="inline-info"><CircleHelp size={16} /><span>در نسخه‌ی بعد می‌توان تعداد ورق و چیدمان بهینه را با تعریف ابعاد ورق خام محاسبه کرد.</span></div>
    </div>
  );
}

function RoadmapPage({ project, warnings }) {
  const suggestions = [
    { code: '01', title: 'بهینه‌سازی چیدمان برش', priority: 'اولویت بالا', description: 'تعریف اندازه‌ی ورق خام، ضخامت تیغ، جهت رگه و فاصله‌ی برش؛ سپس کمینه‌کردن پرت و ساخت نقشه‌ی برش.', icon: Scissors, tone: 'teal' },
    { code: '02', title: 'قیمت‌گذاری و پیش‌فاکتور', priority: 'اولویت بالا', description: 'بانک قیمت MDF، نوار لبه و یراق‌آلات، محاسبه‌ی اجرت، مالیات و خروجی پیش‌فاکتور مشتری.', icon: Package, tone: 'orange' },
    { code: '03', title: 'طراحی تصویری آشپزخانه', priority: 'مرحله‌ی بعد', description: 'نقشه‌ی دوبعدی دیوارها، پنجره و لوازم؛ جابه‌جایی یونیت‌ها با کشیدن و رهاکردن و پیش‌نمایش سه‌بعدی.', icon: PanelTop, tone: 'blue' },
    { code: '04', title: 'خروجی CNC و کارگاه', priority: 'مرحله‌ی بعد', description: 'فایل DXF/CSV، برچسب قطعه با کد یونیت، بارکد، سوراخ‌کاری و خروجی متناسب با دستگاه و اپراتور.', icon: Boxes, tone: 'violet' },
    { code: '05', title: 'مدیریت مشتری و سفارش', priority: 'پیشنهادی', description: 'پرونده‌ی مشتری، نسخه‌بندی طرح، وضعیت اندازه‌گیری/ساخت/نصب، یادداشت‌ها و آرشیو جست‌وجوپذیر.', icon: FileSpreadsheet, tone: 'green' },
    { code: '06', title: 'قواعد قابل تنظیم', priority: 'پیشنهادی', description: 'ویرایش مستقل لقی‌ها، ضخامت ورق، اندازه‌ی پشت‌بند، ابعاد درب، فرمول کشو و پروفایل‌های مختلف کارگاه.', icon: Settings, tone: 'slate' }
  ];

  return (
    <div className="content-wrap">
      <PageHeader eyebrow="روش محاسبه" title="فرمول‌ها و توسعه" description="نسخه‌ی فعلی روی داده‌ی فایل «analiz pro.2.xlsx» ساخته شده و کاملاً محلی کار می‌کند." />

      <div className="rules-banner"><div className="rules-banner-icon"><Ruler size={20} /></div><div><strong>ابعاد فایل واحد اندازه‌گیری را مشخص نکرده‌اند.</strong><span>با توجه به مقادیر، سانتی‌متر فرض شده است؛ این فرض را قبل از تولید با کارگاه تأیید کنید. فایل منبع: {project.sourceFile || 'پروژه‌ی محلی'}.</span></div></div>

      <section className="rules-grid">
        <FormulaCard icon={Boxes} title="کابینت زمینی" lines={[
          'عرض داخلی = عرض − ۳٫۲',
          'عرض درب = عرض ÷ تعداد درب − ۰٫۲',
          'پشت‌بند ۳ میل = (عرض − ۱٫۶) × (ارتفاع + ۰٫۸)',
          'طول طبقه و قید = عرض − ۳٫۲'
        ]} />
        <FormulaCard icon={PanelTop} title="کابینت هوایی" lines={[
          'عرض داخلی = عرض − ۳٫۲',
          'تاق = عمق − ۲؛ طبقه = عمق − ۳',
          'پشت‌بند ۳ میل = (عرض − ۱٫۶) × (ارتفاع − ۰٫۸)',
          'درب = عرض ÷ تعداد درب − ۰٫۲'
        ]} />
        <FormulaCard icon={Layers} title="کشو" lines={[
          'بدنه: طول = عمق − ۵',
          'عرض بدنه = ارتفاع ÷ ۳ − ۴',
          'جلوی کشو: طول = عرض − ۹٫۱',
          'پشت کشو: ۲ سانتی‌متر باریک‌تر از جلو'
        ]} />
      </section>

      <div className="roadmap-section-heading"><div><span className="card-overline">نقشه‌ی راه محصول</span><h3>چه قابلیت‌هایی اضافه کنیم؟</h3></div><span className="roadmap-count">۶ پیشنهاد</span></div>
      <section className="roadmap-grid">
        {suggestions.map(({ code, title, priority, description, icon: Icon, tone }) => (
          <article className="card roadmap-card" key={code}>
            <div className="roadmap-card-top"><div className={`roadmap-icon roadmap-icon-${tone}`}><Icon size={19} /></div><span className="roadmap-code">{code}</span></div>
            <div className="roadmap-copy"><div><h3>{title}</h3><span className="roadmap-priority">{priority}</span></div><p>{description}</p></div>
          </article>
        ))}
      </section>

      <div className="limits-card"><div className="limits-icon"><AlertTriangle size={18} /></div><div><strong>محدودیت‌های نسخه‌ی فعلی</strong><p>محاسبات با قواعد دیده‌شده در شیت‌های اکسل انجام می‌شود. قیمت و تعداد ورق خام، پرت برش، جهت رگه، یراق‌آلات، کف کشو، CNC و نقشه‌ی نصب هنوز محاسبه نمی‌شوند. {warnings.length > 0 && `${formatNumber(warnings.length, 0)} هشدار ابعادی هم برای بررسی وجود دارد.`}</p></div></div>
    </div>
  );
}

function FormulaCard({ icon: Icon, title, lines }) {
  return <div className="card formula-card"><div className="formula-card-title"><div><Icon size={18} /></div><h3>{title}</h3></div><ul>{lines.map((line) => <li key={line}>{line}</li>)}</ul></div>;
}

function UnitDialog({ unit, isNew, onClose, onSave }) {
  const [draft, setDraft] = useState(() => safeCopyUnit(unit));
  const [autoDoors, setAutoDoors] = useState(unit.type === 'drawer' ? false : unit.autoDoors !== false);
  const [error, setError] = useState('');

  const change = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const changePart = (key, value) => setDraft((current) => ({ ...current, parts: { ...(current.parts || {}), [key]: value } }));
  const doorPreview = getDoorCount({ ...draft, autoDoors });

  const submit = (event) => {
    event.preventDefault();
    const dimensionKeys = draft.type === 'drawer'
      ? ['width', 'depth', 'height']
      : draft.type === 'upper'
        ? ['width', 'depth', 'height', 'bottomDepth', 'doorHeight']
        : ['width', 'depth', 'height', 'shelfDepth', 'doorHeight'];
    const invalidDimension = dimensionKeys.some((key) => parseNumber(draft[key], 0) <= 0);
    if (!String(draft.name || '').trim()) {
      setError('برای یونیت یک نام بنویسید.');
      return;
    }
    if (invalidDimension) {
      setError('ابعاد اصلی باید عددی بزرگ‌تر از صفر باشند.');
      return;
    }
    if (draft.type === 'drawer' && parseNumber(draft.count, 0) < 1) {
      setError('تعداد کشو باید حداقل ۱ باشد.');
      return;
    }

    const normalized = {
      ...draft,
      name: String(draft.name).trim(),
      width: parseNumber(draft.width, 0),
      depth: parseNumber(draft.depth, 0),
      height: parseNumber(draft.height, 0)
    };
    if (draft.type === 'drawer') {
      normalized.count = Math.max(1, Math.floor(parseNumber(draft.count, 1)));
    } else {
      normalized.quantity = Math.max(1, Math.floor(parseNumber(draft.quantity, 1)));
      normalized.autoDoors = autoDoors;
      normalized.parts = Object.fromEntries(Object.entries(draft.parts || {}).map(([key, value]) => [
        key,
        key === 'doors' && autoDoors ? null : Math.max(0, Math.floor(parseNumber(value, 0)))
      ]));
      if (draft.type === 'lower') {
        normalized.shelfDepth = parseNumber(draft.shelfDepth, 0);
        normalized.railWidth = parseNumber(draft.railWidth, 0);
        normalized.doorHeight = parseNumber(draft.doorHeight, 73.4);
      } else {
        normalized.bottomDepth = parseNumber(draft.bottomDepth, 0);
        normalized.doorHeight = parseNumber(draft.doorHeight, 92);
      }
    }
    setError('');
    onSave(normalized);
  };

  const typeLabel = TYPE_LABELS[draft.type] || 'یونیت';
  const partRows = draft.type === 'lower'
    ? [['bottom', 'کف'], ['sides', 'بدنه جانبی'], ['shelf', 'طبقه'], ['rail', 'قید'], ['back', 'پشت‌بند ۳ میل']]
    : [['sides', 'بدنه جانبی'], ['bottom', 'کف'], ['top', 'تاق'], ['shelf', 'طبقه'], ['rail', 'قید'], ['back', 'پشت‌بند ۳ میل']];

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="unit-dialog-title">
        <div className="modal-header"><div><span className="modal-eyebrow">{isNew ? 'افزودن به پروژه' : 'ویرایش اطلاعات'}</span><h2 id="unit-dialog-title">{draft.type === 'drawer' ? 'مشخصات مجموعه کشو' : `مشخصات یونیت ${typeLabel}`}</h2></div><button className="icon-button" onClick={onClose} aria-label="بستن"><X size={19} /></button></div>
        <form onSubmit={submit}>
          <div className="modal-body">
            <div className="unit-form-top-grid">
              <FormField label="نام یونیت"><input value={draft.name || ''} onChange={(event) => change('name', event.target.value)} placeholder="مثلاً یونیت زمینی کنار اجاق" /></FormField>
              {draft.type === 'drawer' ? (
                <NumericField label="تعداد کشو" value={draft.count} onChange={(value) => change('count', value)} unit="عدد" />
              ) : (
                <NumericField label="تعداد یونیت مشابه" value={draft.quantity ?? 1} onChange={(value) => change('quantity', value)} unit="عدد" />
              )}
            </div>

            <div className="form-section-heading"><div><span>ابعاد اصلی</span><small>همه‌ی اندازه‌ها مطابق فایل بر حسب سانتی‌متر هستند.</small></div><span className="unit-unit-chip">cm</span></div>
            <div className="form-grid form-grid-3">
              <NumericField label="عرض" value={draft.width} onChange={(value) => change('width', value)} unit="cm" />
              <NumericField label="عمق" value={draft.depth} onChange={(value) => change('depth', value)} unit="cm" />
              <NumericField label="ارتفاع" value={draft.height} onChange={(value) => change('height', value)} unit="cm" />
              {draft.type === 'lower' && <NumericField label="عمق طبقه" value={draft.shelfDepth} onChange={(value) => change('shelfDepth', value)} unit="cm" />}
              {draft.type === 'lower' && <NumericField label="عرض قید" value={draft.railWidth} onChange={(value) => change('railWidth', value)} unit="cm" />}
              {draft.type === 'upper' && <NumericField label="عمق کف" value={draft.bottomDepth} onChange={(value) => change('bottomDepth', value)} unit="cm" />}
              {draft.type !== 'drawer' && <NumericField label="ارتفاع درب" value={draft.doorHeight} onChange={(value) => change('doorHeight', value)} unit="cm" />}
            </div>

            {draft.type !== 'drawer' ? (
              <div className="components-editor">
                <div className="form-section-heading"><div><span>تعداد قطعات هر یونیت</span><small>این مقادیر برای هر یونیت مشابه تکرار می‌شوند.</small></div></div>
                <div className="part-count-grid">
                  {partRows.map(([key, label]) => <NumericField key={key} label={label} value={draft.parts?.[key] ?? 0} onChange={(value) => changePart(key, value)} unit="قطعه" compact />)}
                  <div className="door-count-field">
                    <div className="door-count-title"><span>درب</span><label className="toggle-row"><input type="checkbox" checked={autoDoors} onChange={(event) => { setAutoDoors(event.target.checked); if (!event.target.checked) changePart('doors', doorPreview); }} /><span className="toggle-track" /><small>خودکار</small></label></div>
                    {autoDoors ? <div className="auto-door-preview"><strong>{formatNumber(doorPreview, 0)}</strong><span>درب، بر اساس عرض</span></div> : <NumericField label="تعداد درب دستی" value={draft.parts?.doors ?? 0} onChange={(value) => changePart('doors', value)} unit="قطعه" compact />}
                  </div>
                </div>
              </div>
            ) : (
              <div className="drawer-formula-hint"><Layers size={17} /><span>این مجموعه از هر کشو ۲ بدنه، ۱ جلو و ۱ پشت محاسبه می‌کند؛ مطابق شیت «کشو»ی فایل اصلی.</span></div>
            )}
            {error && <div className="form-error"><AlertTriangle size={15} />{error}</div>}
          </div>
          <div className="modal-footer"><span className="autosave-footnote"><CheckCircle2 size={14} /> ذخیره‌ی محلی و خودکار</span><div><button type="button" className="button button-quiet" onClick={onClose}>انصراف</button><button type="submit" className="button button-primary"><Check size={16} /> {isNew ? 'افزودن به پروژه' : 'ذخیره تغییرات'}</button></div></div>
        </form>
      </div>
    </div>
  );
}

function FormField({ label, children }) {
  return <label className="form-field"><span>{label}</span>{children}</label>;
}

function NumericField({ label, value, onChange, unit, compact = false }) {
  return (
    <label className={`form-field numeric-field ${compact ? 'numeric-field-compact' : ''}`}>
      <span>{label}</span>
      <div className="numeric-input-wrap"><input type="text" inputMode="decimal" dir="ltr" value={value ?? ''} onChange={(event) => onChange(event.target.value)} /><em>{unit}</em></div>
    </label>
  );
}

function ProjectDialog({ project, onClose, onSave }) {
  const [name, setName] = useState(project.name || '');
  const [customer, setCustomer] = useState(project.customer || '');
  const [notes, setNotes] = useState(project.notes || '');
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal modal-project" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title">
        <div className="modal-header"><div><span className="modal-eyebrow">پروژه‌ی فعال</span><h2 id="project-dialog-title">مشخصات پروژه</h2></div><button className="icon-button" onClick={onClose} aria-label="بستن"><X size={19} /></button></div>
        <form onSubmit={(event) => { event.preventDefault(); onSave({ name: name.trim() || 'پروژه بدون نام', customer: customer.trim(), notes: notes.trim() }); }}>
          <div className="modal-body project-form-body">
            <FormField label="نام پروژه"><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="مثلاً آشپزخانه طبقه‌ی اول" /></FormField>
            <FormField label="مشتری / سفارش‌دهنده"><input value={customer} onChange={(event) => setCustomer(event.target.value)} placeholder="نام مشتری (اختیاری)" /></FormField>
            <FormField label="یادداشت"><textarea rows="4" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="توضیحات اندازه‌گیری یا نکته‌های نصب..." /></FormField>
            <div className="local-data-note"><CheckCircle2 size={16} /><span>اطلاعات روی همین دستگاه نگهداری می‌شود و به فضای ابری ارسال نمی‌شود.</span></div>
          </div>
          <div className="modal-footer"><span className="autosave-footnote"><FileSpreadsheet size={14} /> {project.sourceFile || 'بدون فایل ورودی'}</span><div><button type="button" className="button button-quiet" onClick={onClose}>انصراف</button><button type="submit" className="button button-primary"><Check size={16} /> ذخیره</button></div></div>
        </form>
      </div>
    </div>
  );
}

export default App;
