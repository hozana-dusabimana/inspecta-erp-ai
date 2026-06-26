import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ArrowLeft, 
  Calendar, 
  CloudSun, 
  HardHat, 
  Info, 
  Upload, 
  CheckCircle2, 
  Clock, 
  Camera,
  Layers,
  HelpCircle,
  TrendingUp,
  AlertTriangle,
  FileText,
  User,
  Loader2
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { AppView, DailyProductionEntry } from '../types';
import { api } from '../lib/api';

interface DailyEntryProps {
  onNavigate: (view: AppView) => void;
  onSubmitSuccess: (entry: DailyProductionEntry) => void;
}

interface WbsActivityOption {
  code: string;
  name: string;
  plannedQty: number;
  unit: string;
  baselineHours: number;
}

const wbsActivities: WbsActivityOption[] = [
  { code: 'C.01.04', name: 'Reinforced Concrete Slab', plannedQty: 45.0, unit: 'm³', baselineHours: 72 },
  { code: 'C.01.05', name: 'Vertical Formwork Installation', plannedQty: 120.0, unit: 'm²', baselineHours: 48 },
  { code: 'C.02.01', name: 'Site Preparation & Excavation', plannedQty: 350.0, unit: 'm³', baselineHours: 96 },
  { code: 'C.03.12', name: 'Steel Reinforcement Assembly', plannedQty: 12.5, unit: 'tons', baselineHours: 64 },
];

export default function DailyEntry({ onNavigate, onSubmitSuccess }: DailyEntryProps) {
  // Form States
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [selectedWbs, setSelectedWbs] = useState<WbsActivityOption>(wbsActivities[0]);
  const [actualQty, setActualQty] = useState<string>('42');
  const [laborHours, setLaborHours] = useState<string>('68');
  const [weather, setWeather] = useState('Partly Cloudy');
  const [equipmentHours, setEquipmentHours] = useState<string>('18');
  const [remarks, setRemarks] = useState('');
  
  // Photo state
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([
    'https://images.unsplash.com/photo-1541888946425-d81bb19240f5?auto=format&fit=crop&w=600&q=80' // default premium construction photo
  ]);
  
  // Status states
  const [isSyncing, setIsSyncing] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [productivityIndex, setProductivityIndex] = useState(1.05);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Real projects for the entry (production records are project-scoped).
  const { data: projectsResp } = useQuery({
    queryKey: ['projects', 'picker'],
    queryFn: () => api.get<{ id: string; name: string; code: string }[]>('/projects?pageSize=200'),
  });
  const projects = projectsResp?.data ?? [];
  const [projectId, setProjectId] = useState('');
  useEffect(() => {
    if (!projectId && projects.length) setProjectId(projects[0].id);
  }, [projects, projectId]);

  // Dynamic Productivity Index Calculation
  useEffect(() => {
    const actual = parseFloat(actualQty);
    const hours = parseFloat(laborHours);
    
    if (isNaN(actual) || isNaN(hours) || hours <= 0 || actual <= 0) {
      setProductivityIndex(0);
      return;
    }

    // Efficiency computation:
    // Productivity ratio = (Actual Volume / Planned Volume) / (Actual Hours / Baseline Hours)
    const qtyRatio = actual / selectedWbs.plannedQty;
    const hoursRatio = hours / selectedWbs.baselineHours;
    
    if (hoursRatio === 0) {
      setProductivityIndex(0);
      return;
    }

    const calculatedIndex = qtyRatio / hoursRatio;
    setProductivityIndex(Math.round(calculatedIndex * 100) / 100);
  }, [actualQty, laborHours, selectedWbs]);

  // Handle selected WBS trigger updates
  const handleWbsChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = wbsActivities.find(item => item.code === e.target.value);
    if (selected) {
      setSelectedWbs(selected);
      // set reasonable starting actual values
      setActualQty(Math.round(selected.plannedQty * 0.93).toString());
      setLaborHours(Math.round(selected.baselineHours * 0.95).toString());
    }
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const readers = Array.from(files).map((file: any) => {
        return new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
      });

      Promise.all(readers).then(results => {
        setPhotoPreviews(prev => [...prev, ...results]);
      });
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const readers = Array.from(files).map((file: any) => {
        return new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
      });

      Promise.all(readers).then(results => {
        setPhotoPreviews(prev => [...prev, ...results]);
      });
    }
  };

  const removePhoto = (index: number) => {
    setPhotoPreviews(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (!projectId) {
      setSubmitError('Please select a project before syncing.');
      return;
    }
    setIsSyncing(true);

    try {
      // Real synchronization to the ERP production module.
      await api.post('/production', {
        projectId,
        date: new Date(entryDate).toISOString(),
        wbsActivity: `${selectedWbs.code} - ${selectedWbs.name}`,
        unit: 'unit',
        plannedQty: selectedWbs.plannedQty,
        actualQty: parseFloat(actualQty) || 0,
        laborHours: parseFloat(laborHours) || 0,
        equipmentHours: parseFloat(equipmentHours) || 0,
        weatherCondition: weather,
        remarks,
        // Only persist remote URLs; large base64 previews are skipped.
        photos: photoPreviews.filter((p) => p.startsWith('http')),
      });

      setShowSuccessModal(true);
      onSubmitSuccess({
        id: Math.random().toString(),
        date: entryDate,
        wbsActivity: `${selectedWbs.code} - ${selectedWbs.name}`,
        plannedQty: selectedWbs.plannedQty,
        actualQty: parseFloat(actualQty),
        laborHours: parseFloat(laborHours),
        weatherCondition: weather,
        remarks,
        photos: photoPreviews,
        status: 'synced',
        timestamp: new Date().toLocaleTimeString(),
      });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to sync entry');
    } finally {
      setIsSyncing(false);
    }
  };

  // Determine Productivity Index Status Styling
  const getProductivityStatus = () => {
    if (productivityIndex === 0) return { label: 'Incomplete', color: 'text-brand-on-surface-variant bg-brand-surface-container', barColor: 'bg-brand-outline-variant' };
    if (productivityIndex >= 1.0) {
      return { 
        label: 'Optimal', 
        color: 'text-brand-tertiary bg-brand-tertiary-fixed-dim/20 border border-brand-tertiary-fixed-dim/40', 
        barColor: 'bg-brand-tertiary-fixed-dim' 
      };
    }
    if (productivityIndex >= 0.85) {
      return { 
        label: 'Caution', 
        color: 'text-brand-on-secondary-container bg-brand-secondary-container/10 border border-brand-secondary-container/20', 
        barColor: 'bg-brand-secondary-container' 
      };
    }
    return { 
      label: 'Critical', 
      color: 'text-brand-status-critical bg-red-50 border border-red-200', 
      barColor: 'bg-brand-status-critical' 
    };
  };

  const prodStatus = getProductivityStatus();

  return (
    <div className="min-h-screen bg-brand-surface text-brand-on-surface font-sans" id="daily-entry-root">
      {/* Top Header */}
      <header className="h-16 w-full sticky top-0 z-40 bg-white/90 backdrop-blur-md flex justify-between items-center px-6 md:px-8 border-b border-brand-outline-variant/10 shadow-sm">
        <div className="flex items-center gap-3">
          <button 
            id="btn-back-dashboard"
            onClick={() => onNavigate(AppView.DASHBOARD)}
            className="p-2 rounded-lg hover:bg-brand-surface transition-all text-brand-primary cursor-pointer flex items-center justify-center"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          
          <div className="h-6 w-[1px] bg-brand-outline-variant/30"></div>
          
          <div>
            <h2 className="font-display text-lg font-extrabold text-brand-primary">Daily Entry</h2>
            <p className="text-[10px] text-brand-on-surface-variant font-bold uppercase tracking-wider">Site node: Skyline Tower A</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-xs font-bold text-brand-on-surface">Alex Thompson</p>
              <p className="text-[9px] text-brand-on-surface-variant uppercase font-bold tracking-widest">Project Director</p>
            </div>
            <div className="w-10 h-10 rounded-full border border-brand-primary-container/20 bg-brand-surface-container flex items-center justify-center text-brand-primary font-bold text-sm">
              AT
            </div>
          </div>
        </div>
      </header>

      {/* Form Canvas Container */}
      <main className="max-w-4xl mx-auto p-6 md:p-8 space-y-6">
        
        {/* Dynamic Productivity Glass Panel Alert */}
        <div className="glass-panel p-6 rounded-2xl shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-6 bg-white relative overflow-hidden border-brand-primary/10">
          <div className="ai-shimmer absolute inset-0 opacity-10 pointer-events-none"></div>
          
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-brand-primary font-bold text-sm">
              <TrendingUp className="w-5 h-5 text-brand-secondary-container" />
              <span>Real-Time Productivity Auditor</span>
            </div>
            <p className="text-brand-on-surface-variant text-xs leading-relaxed max-w-md">
              Calculated dynamically as actual volume divided by budgeted labor-unit benchmarks. Keeps your field reports synchronized with baseline estimates.
            </p>
          </div>

          <div className="flex items-center gap-4 bg-brand-surface px-5 py-4 rounded-xl border border-brand-outline-variant/20 shrink-0 w-full md:w-auto justify-between md:justify-start">
            <div className="text-right">
              <p className="text-[10px] text-brand-on-surface-variant font-bold uppercase tracking-wider">Productivity Index</p>
              <div className="flex items-baseline gap-1.5 mt-1 justify-end">
                <span className="font-mono text-3xl font-extrabold text-brand-primary">{productivityIndex === 0 ? '---' : productivityIndex}</span>
                {productivityIndex > 0 && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${prodStatus.color}`}>{prodStatus.label}</span>}
              </div>
            </div>
            
            <div className="h-10 w-[1px] bg-brand-outline-variant/35 hidden md:block"></div>
            
            <div className="w-24 h-2 bg-brand-surface-container rounded-full overflow-hidden hidden md:block">
              <div className={`h-full ${prodStatus.barColor} transition-all duration-500`} style={{ width: `${Math.min(productivityIndex * 80, 100)}%` }}></div>
            </div>
          </div>
        </div>

        {/* Daily Production Form */}
        <form onSubmit={handleSubmit} className="bg-white p-6 md:p-8 rounded-2xl border border-brand-outline-variant/20 shadow-md space-y-6" id="daily-production-form">
          {/* Field: Project (real, required) */}
          <div className="space-y-1.5">
            <label className="font-sans text-xs font-bold text-brand-on-surface-variant flex items-center gap-1" htmlFor="project-select">
              <Layers className="w-4 h-4 text-brand-primary" />
              <span>PROJECT</span>
            </label>
            <select
              id="project-select"
              required
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full h-11 bg-brand-surface border border-brand-outline-variant rounded-lg px-3 text-xs font-semibold text-brand-primary outline-none focus:border-brand-primary transition-all"
            >
              <option value="">Select project…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* Field: Entry Date */}
            <div className="space-y-1.5">
              <label className="font-sans text-xs font-bold text-brand-on-surface-variant flex items-center gap-1" htmlFor="date-input">
                <Calendar className="w-4 h-4 text-brand-primary" />
                <span>ENTRY DATE</span>
              </label>
              <input 
                id="date-input"
                type="date"
                required
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                className="w-full h-11 bg-brand-surface border border-brand-outline-variant rounded-lg px-3 text-xs font-semibold text-brand-primary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10 transition-all"
              />
            </div>

            {/* Field: Weather Condition */}
            <div className="space-y-1.5">
              <label className="font-sans text-xs font-bold text-brand-on-surface-variant flex items-center gap-1" htmlFor="weather-select">
                <CloudSun className="w-4 h-4 text-brand-primary" />
                <span>WEATHER CONDITION</span>
              </label>
              <select 
                id="weather-select"
                value={weather}
                onChange={(e) => setWeather(e.target.value)}
                className="w-full h-11 bg-brand-surface border border-brand-outline-variant rounded-lg px-3 text-xs font-semibold text-brand-primary outline-none focus:border-brand-primary transition-all"
              >
                <option value="Sunny / Clear">Sunny / Clear</option>
                <option value="Partly Cloudy">Partly Cloudy</option>
                <option value="Light Rain">Light Rain</option>
                <option value="Heavy Rain / Storm">Heavy Rain / Storm (Stops Operations)</option>
                <option value="High Winds">High Winds (Stops Crane Operations)</option>
              </select>
            </div>

            {/* Field: WBS Activity */}
            <div className="md:col-span-2 space-y-1.5">
              <label className="font-sans text-xs font-bold text-brand-on-surface-variant flex items-center gap-1" htmlFor="wbs-select">
                <Layers className="w-4 h-4 text-brand-primary" />
                <span>WBS WORK ACTIVITY</span>
              </label>
              <select 
                id="wbs-select"
                value={selectedWbs.code}
                onChange={handleWbsChange}
                className="w-full h-11 bg-brand-surface border border-brand-outline-variant rounded-lg px-3 text-xs font-semibold text-brand-primary outline-none focus:border-brand-primary transition-all"
              >
                {wbsActivities.map((act) => (
                  <option key={act.code} value={act.code}>
                    {act.code} - {act.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Field: Planned Quantity (Read-only reference) */}
            <div className="space-y-1.5">
              <label className="font-sans text-xs font-bold text-brand-on-surface-variant block">PLANNED QUANTITY (ESTIMATE)</label>
              <div className="h-11 w-full bg-brand-surface-container border border-brand-outline-variant rounded-lg px-3 flex items-center justify-between text-xs font-bold text-brand-primary select-none">
                <span>{selectedWbs.plannedQty}</span>
                <span className="font-mono text-[10px] text-brand-on-surface-variant">{selectedWbs.unit}</span>
              </div>
            </div>

            {/* Field: Actual Qty */}
            <div className="space-y-1.5">
              <label className="font-sans text-xs font-bold text-brand-on-surface-variant block" htmlFor="actual-qty-input">
                ACTUAL QUANTITY COMPLETED
              </label>
              <div className="relative group">
                <input 
                  id="actual-qty-input"
                  type="number"
                  required
                  min="0.1"
                  step="0.1"
                  value={actualQty}
                  onChange={(e) => setActualQty(e.target.value)}
                  placeholder="Enter volume completed"
                  className="w-full h-11 bg-brand-surface border border-brand-outline-variant rounded-lg pl-3 pr-10 text-xs font-semibold outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10 transition-all text-brand-primary"
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[10px] font-mono font-bold text-brand-on-surface-variant">
                  {selectedWbs.unit}
                </span>
              </div>
            </div>

            {/* Field: Labor Hours */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="font-sans text-xs font-bold text-brand-on-surface-variant block" htmlFor="labor-hours-input">
                  LABOR HOURS UTILIZED
                </label>
                <span className="text-[9px] font-bold text-brand-secondary-container">Allocated: 12 Crew Members</span>
              </div>
              <div className="relative group">
                <input 
                  id="labor-hours-input"
                  type="number"
                  required
                  min="1"
                  value={laborHours}
                  onChange={(e) => setLaborHours(e.target.value)}
                  placeholder="Enter collective labor hours"
                  className="w-full h-11 bg-brand-surface border border-brand-outline-variant rounded-lg pl-3 pr-10 text-xs font-semibold outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10 transition-all text-brand-primary"
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[10px] font-mono font-bold text-brand-on-surface-variant">
                  m-hrs
                </span>
              </div>
            </div>

            {/* Field: Equipment Hours */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="font-sans text-xs font-bold text-brand-on-surface-variant block" htmlFor="equipment-hours-input">
                  EQUIPMENT HOURS
                </label>
                <span className="text-[9px] font-bold text-brand-on-surface-variant">Active: 3 Excavators</span>
              </div>
              <div className="relative group">
                <input 
                  id="equipment-hours-input"
                  type="number"
                  min="0"
                  value={equipmentHours}
                  onChange={(e) => setEquipmentHours(e.target.value)}
                  placeholder="Enter equipment hours"
                  className="w-full h-11 bg-brand-surface border border-brand-outline-variant rounded-lg pl-3 pr-10 text-xs font-semibold outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10 transition-all text-brand-primary"
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[10px] font-mono font-bold text-brand-on-surface-variant">
                  eq-hrs
                </span>
              </div>
            </div>

            {/* Field: Remarks / Blockers */}
            <div className="md:col-span-2 space-y-1.5">
              <label className="font-sans text-xs font-bold text-brand-on-surface-variant flex items-center gap-1" htmlFor="remarks-textarea">
                <FileText className="w-4 h-4 text-brand-primary" />
                <span>REMARKS / SITE BLOCKERS</span>
              </label>
              <textarea 
                id="remarks-textarea"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="List geological hurdles, material delays, sub-contractor friction, or physical obstructions..."
                className="w-full h-24 bg-brand-surface border border-brand-outline-variant rounded-lg p-3 text-xs font-semibold outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10 transition-all text-brand-primary resize-none"
              />
            </div>

            {/* Field: Photo verification drag-and-drop */}
            <div className="md:col-span-2 space-y-2">
              <label className="font-sans text-xs font-bold text-brand-on-surface-variant flex items-center gap-1">
                <Camera className="w-4 h-4 text-brand-primary" />
                <span>PROGRESS VERIFICATION</span>
              </label>
              
              <div 
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                className="border-2 border-dashed border-brand-outline-variant/60 rounded-xl p-5 text-center bg-brand-surface-container-lowest flex flex-col items-center justify-center cursor-pointer hover:border-brand-primary transition-colors relative group"
              >
                <input 
                  type="file" 
                  id="photo-uploader" 
                  multiple 
                  accept="image/*"
                  onChange={handlePhotoUpload}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
                <Upload className="w-8 h-8 text-brand-outline group-hover:text-brand-primary transition-colors mb-2" />
                <p className="text-xs font-bold text-brand-primary">Drag photos here or click to browse</p>
                <p className="text-[10px] text-brand-on-surface-variant mt-1">Upload JPEG, PNG files up to 10MB to bind to ledger.</p>
              </div>

              {/* Photos Grid Previews */}
              {photoPreviews.length > 0 && (
                <div className="grid grid-cols-4 gap-3 pt-2">
                  {photoPreviews.map((src, index) => (
                    <div key={index} className="aspect-square rounded-lg overflow-hidden border border-brand-outline-variant/30 relative group">
                      <img src={src} alt="site snapshot" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      <button 
                        type="button"
                        onClick={() => removePhoto(index)}
                        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-brand-on-surface/75 text-white flex items-center justify-center hover:bg-brand-status-critical transition-colors text-[10px] font-bold"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="h-[1px] bg-brand-outline-variant/30 my-6" />

          {submitError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-semibold text-red-700">
              {submitError}
            </div>
          )}

          {/* Form Actions footer */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-brand-secondary-container animate-pulse"></span>
              <span className="text-xs font-semibold text-brand-on-surface-variant">Draft Saved Locally • Ready to Sync</span>
            </div>
            
            <div className="flex gap-3 w-full sm:w-auto">
              <button 
                type="button"
                onClick={() => onNavigate(AppView.DASHBOARD)}
                className="flex-1 sm:flex-none px-6 py-3 bg-brand-surface-container-low border border-brand-outline-variant rounded-lg font-bold text-xs hover:bg-brand-surface-container-high transition-all"
              >
                Cancel
              </button>
              <button 
                type="submit"
                id="btn-submit-erp"
                disabled={isSyncing}
                className="flex-1 sm:flex-none px-8 py-3 bg-brand-primary text-white font-bold text-xs rounded-lg shadow-lg hover:bg-brand-primary-container transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {isSyncing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Pushing to ERP...</span>
                  </>
                ) : (
                  <span>Submit to ERP</span>
                )}
              </button>
            </div>
          </div>
        </form>
      </main>

      {/* Success Modal Overlay */}
      <AnimatePresence>
        {showSuccessModal && (
          <div className="fixed inset-0 z-50 bg-brand-on-background/40 backdrop-blur-sm flex items-center justify-center px-4" id="success-sync-modal">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white max-w-sm w-full rounded-2xl p-6 text-center shadow-2xl relative"
            >
              <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-500 border border-emerald-200 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              
              <h3 className="font-display text-lg font-extrabold text-brand-primary mb-1">Ledger Sync Successful</h3>
              <p className="text-brand-on-surface-variant text-xs leading-relaxed mb-6">
                Your daily production records have been safely recorded, timestamped, and reconciled with the corporate Spanner ledger nodes.
              </p>

              <div className="space-y-2">
                <button 
                  id="btn-success-ok"
                  onClick={() => {
                    setShowSuccessModal(false);
                    onNavigate(AppView.DASHBOARD);
                  }}
                  className="w-full py-3 bg-brand-primary text-white font-bold text-xs rounded-lg shadow hover:bg-brand-primary-container transition-all cursor-pointer"
                >
                  Return to Executive Dashboard
                </button>
                <button 
                  id="btn-success-another"
                  type="button"
                  onClick={() => {
                    setShowSuccessModal(false);
                    setRemarks('');
                    setActualQty('0');
                    setLaborHours('0');
                  }}
                  className="w-full py-3 bg-brand-surface border border-brand-outline-variant text-brand-primary font-bold text-xs rounded-lg hover:bg-brand-surface-container-low transition-all"
                >
                  Log Another Entry
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
