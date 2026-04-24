/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { 
  Upload, 
  Code, 
  Layers, 
  RefreshCw, 
  Copy, 
  Check, 
  Plus, 
  Trash2, 
  ChevronRight, 
  Eye, 
  EyeOff,
  Maximize2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Initialize Gemini API
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface BoundingBox {
  y1: number;
  x1: number;
  y2: number;
  x2: number;
  label: string;
  id: string;
}

interface AnalysisState {
  isAnalyzing: boolean;
  isGenerating: boolean;
  boxes: BoundingBox[];
  generatedCode: string;
  error: string | null;
}

export default function App() {
  const [image, setImage] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisState>({
    isAnalyzing: false,
    isGenerating: false,
    boxes: [],
    generatedCode: '',
    error: null,
  });
  const [showOverlay, setShowOverlay] = useState(true);
  const [manualPoints, setManualPoints] = useState<{ x: number, y: number }[]>([]);
  const [copied, setCopied] = useState(false);
  const [previewMode, setPreviewMode] = useState<'heatmap' | 'code'>('heatmap');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setImage(event.target?.result as string);
        setAnalysis({ isAnalyzing: false, isGenerating: false, boxes: [], generatedCode: '', error: null });
        setManualPoints([]);
      };
      reader.readAsDataURL(file);
    }
  };

  const analyzeImage = async () => {
    if (!image) return;

    setAnalysis(prev => ({ ...prev, isAnalyzing: true, error: null }));
    try {
      const base64Data = image.split(',')[1];
      const prompt = `Act as a precision UI parser. Analyze this screenshot carefully.
      1. Identify ALL visual components (buttons, nav items, text blocks, images, forms, inputs).
      2. For each, determine its bounding box in [y1, x1, y2, x2] normalized coordinates (0-1000).
      3. Return ONLY a JSON array of objects.
      4. Even if the image is small, blurry, or low resolution, perform your best estimation of the layout.
      5. Output format: [{"y1": number, "x1": number, "y2": number, "x2": number, "label": string}]`;

      const response = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: {
          parts: [
            { inlineData: { data: base64Data, mimeType: "image/png" } },
            { text: prompt }
          ]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                y1: { type: Type.NUMBER },
                x1: { type: Type.NUMBER },
                y2: { type: Type.NUMBER },
                x2: { type: Type.NUMBER },
                label: { type: Type.STRING }
              }
            }
          }
        }
      });

      let boxes = [];
      
      try {
        const text = response.text;
        boxes = JSON.parse(text || '[]').map((b: any, index: number) => ({
          y1: Number(b.y1),
          x1: Number(b.x1),
          y2: Number(b.y2),
          x2: Number(b.x2),
          label: String(b.label || 'element'),
          id: `box-${index}-${Date.now()}`
        }));
      } catch (parseErr) {
        console.error("Parse Error:", parseErr);
        throw new Error("Could not parse system scan results. Please try scanning again.");
      }

      setAnalysis(prev => ({ 
        ...prev, 
        isAnalyzing: false, 
        boxes: boxes.length > 0 ? boxes : prev.boxes 
      }));
      
    } catch (err: any) {
      console.error("Scan Error:", err);
      setAnalysis(prev => ({ 
        ...prev, 
        isAnalyzing: false, 
        error: `SYSTEM_SCAN_FAILURE: ${err.message || 'Unknown error'}` 
      }));
    } finally {
      // Safety reset to prevent UI hanging
      setAnalysis(prev => ({ ...prev, isAnalyzing: false }));
    }
  };

  const generateCode = async () => {
    if (!image) return;

    setAnalysis(prev => ({ ...prev, isGenerating: true, error: null }));
    try {
      const base64Data = image.split(',')[1];
      
      const pointsInfo = manualPoints.length > 0 
        ? `CRITICAL USER OVERRIDE: The user has manually identified ${manualPoints.length} key elements at these normalized [x, y] coordinates: ${JSON.stringify(manualPoints)}. YOU MUST identify and code elements at these exact locations, even if your automated scan missed them. These are high-priority focus areas that need pixel-perfect implementation.`
        : '';
      
      const prompt = `Act as a master frontend engineer specialized in Elementor Custom HTML widgets. 
      Generate a SINGLE-BLOCK HTML document based on this UI screenshot and detected structures: ${JSON.stringify(analysis.boxes.map(b => ({ label: b.label, box: [b.y1, b.x1, b.y2, b.x2] })))}.
      
      ${pointsInfo}
      
      CRITICAL FORMATTING RULES:
      1. MUST be a single block of code (HTML + CSS + JS all together).
      2. TOP COMMENT BLOCK MUST INCLUDE:
         <!-- 
         TITLE: [Identify Section Name from UI]
         ✅ PIXEL PERFECT REPLICA
         ✅ FULLY RESPONSIVE (MOBILE + DESKTOP)
         ✅ SELF-CONTAINED CSS & JS
         ✅ FONT AWESOME INTEGRATED
         
         INSTRUCTION: Paste this ENTIRE block into an Elementor Custom HTML widget.
         -->
      
      TECHNICAL REQUIREMENTS:
      - CSS: Use a <style> tag. Handle mobile/desktop with media queries. Use 'Montserrat' (import from Google Fonts). Match colors, spacing, and hover effects exactly.
      - JS: Use a <script> tag at the bottom for any interactions.
      - ICONS: Always include Font Awesome CDN: <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
      - COMMENTS: Add helpful comments throughout the code explaining the structure for developers.
      - QUALITY: Aim for "Pixel Perfect" fidelity. Ensure it is a complete, standalone widget.`;

      const response = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: {
          parts: [
            { inlineData: { data: base64Data, mimeType: "image/png" } },
            { text: prompt }
          ]
        }
      });

      const rawText = response.text || '';
      const cleanedCode = rawText.replace(/```html|```/g, '').trim();

      setAnalysis(prev => ({ ...prev, isGenerating: false, generatedCode: cleanedCode }));
      setPreviewMode('code');
    } catch (err: any) {
      console.error(err);
      setAnalysis(prev => ({ ...prev, isGenerating: false, error: 'Code generation failed.' }));
    } finally {
      setAnalysis(prev => ({ ...prev, isGenerating: false }));
    }
  };

  const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!imageContainerRef.current) return;
    
    // Improved coordinate mapping: find the actual image child
    const img = imageContainerRef.current.querySelector('img');
    if (!img) return;

    const rect = img.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const x = ((e.clientX - rect.left) / rect.width) * 1000;
    const y = ((e.clientY - rect.top) / rect.height) * 1000;

    // Boundary check to ensure points stick to image
    if (x >= 0 && x <= 1000 && y >= 0 && y <= 1000) {
      setManualPoints(prev => [...prev, { x, y }]);
    }
  };

  const removePoint = (idx: number) => {
    setManualPoints(prev => prev.filter((_, i) => i !== idx));
  };

  const clearPoints = () => setManualPoints([]);

  const copyCode = () => {
    if (!analysis.generatedCode) return;
    navigator.clipboard.writeText(analysis.generatedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-black text-white font-mono selection:bg-white selection:text-black flex flex-col">
      {/* Navigation */}
      <nav className="h-16 border-b border-white/20 flex items-center justify-between px-8 bg-black sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 bg-white flex items-center justify-center text-black font-bold text-xl">V</div>
          <h1 className="text-lg font-bold tracking-tighter uppercase whitespace-nowrap">VISION_REPLICA v1.0.4</h1>
        </div>
        
        <div className="flex items-center gap-6">
          <div className="hidden sm:flex items-center gap-2 text-[10px] opacity-50 uppercase tracking-widest">
            <div className={`w-2 h-2 rounded-full ${image ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-white/20'}`}></div>
            {image ? 'ENGINE_ACTIVE' : 'ENGINE_IDLE'}
          </div>
          <label className="cursor-pointer group">
            <input 
              type="file" 
              className="hidden" 
              accept="image/*" 
              onChange={handleImageUpload} 
              ref={fileInputRef}
            />
            <div className="px-4 py-2 border border-white hover:bg-white hover:text-black transition-all duration-200 text-xs font-bold uppercase whitespace-nowrap">
              {image ? 'RE_UPLOAD_SOURCE' : 'UPLOAD_NEW_SCREENSHOT'}
            </div>
          </label>
        </div>
      </nav>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {!image ? (
          <div 
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 bg-[#0a0a0a] relative flex flex-col items-center justify-center gap-8 cursor-pointer group"
          >
            <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '24px 24px' }}></div>
            <div className="w-24 h-24 border border-white/20 rounded-full flex items-center justify-center group-hover:scale-110 group-hover:border-white transition-all bg-black shadow-2xl relative z-10">
              <Upload className="w-8 h-8 text-white/40 group-hover:text-white" />
            </div>
            <div className="text-center relative z-10 px-6">
              <p className="text-xl font-bold tracking-tighter uppercase mb-2">Initialize Visual Ingestion</p>
              <p className="text-[10px] text-white/40 uppercase tracking-[0.3em]">Drag-and-drop or click to parse UI structure</p>
            </div>
          </div>
        ) : (
          <>
            {/* Analysis Canvas (Left) */}
            <section className="flex-1 bg-[#0a0a0a] relative flex flex-col p-4 lg:p-8 overflow-hidden min-h-[500px]">
              <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '24px 24px' }}></div>
              
              <div className="mb-6 flex flex-wrap gap-4 items-center justify-between z-10">
                <div className="flex gap-[1px] bg-white/10 border border-white/20 p-[1px]">
                  <button 
                    onClick={() => setPreviewMode('heatmap')}
                    className={`px-6 py-2 text-[10px] font-bold tracking-[0.2em] uppercase transition-all ${previewMode === 'heatmap' ? 'bg-white text-black' : 'text-white/60 hover:text-white hover:bg-white/5'}`}
                  >
                    STRUCTURE
                  </button>
                  <button 
                    onClick={() => setPreviewMode('code')}
                    disabled={!analysis.generatedCode}
                    className={`px-6 py-2 text-[10px] font-bold tracking-[0.2em] uppercase transition-all ${previewMode === 'code' ? 'bg-white text-black' : 'text-white/60 hover:text-white hover:bg-white/5 disabled:opacity-20'}`}
                  >
                    CODE_GEN
                  </button>
                </div>

                <div className="flex gap-2">
                   <button 
                    onClick={() => setShowOverlay(!showOverlay)}
                    className={`p-2 border transition-all ${showOverlay ? 'bg-white text-black border-white' : 'border-white/20 text-white/60 hover:border-white hover:text-white'}`}
                    title="Toggle Layers"
                  >
                    {showOverlay ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  </button>
                  <button 
                    onClick={clearPoints}
                    className="p-2 border border-white/20 text-white/60 hover:border-white hover:text-white transition-all disabled:opacity-20"
                    disabled={manualPoints.length === 0}
                    title="Clear Focus Points"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="relative flex-1 border border-white/20 bg-[#111] shadow-2xl flex items-center justify-center overflow-hidden">
                <div className="absolute top-0 left-0 w-full p-2 border-b border-white/10 flex items-center justify-between bg-black/60 backdrop-blur-md z-30">
                  <div className="flex gap-1.5 px-2">
                    <div className="w-2 h-2 rounded-full bg-white/20" />
                    <div className="w-2 h-2 rounded-full bg-white/20" />
                    <div className="w-2 h-2 rounded-full bg-white/20" />
                  </div>
                  <div className="text-[9px] font-mono opacity-40 uppercase tracking-widest truncate max-w-[200px]">
                    SCANNING_BUFFER // {previewMode.toUpperCase()}
                  </div>
                  <div className="w-8" />
                </div>

                <div className="relative w-full h-full flex items-center justify-center overflow-auto p-4 lg:p-12">
                  <AnimatePresence mode="wait">
                    {previewMode === 'heatmap' ? (
                      <motion.div
                        key="heatmap"
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 1.02 }}
                        className="relative cursor-crosshair max-w-full"
                        ref={imageContainerRef}
                        onClick={handleContainerClick}
                      >
                        <img 
                          src={image} 
                          className="max-w-full h-auto block select-none border border-white/10" 
                          alt="UI Reference"
                        />
                        {showOverlay && (
                           <svg 
                           className="absolute inset-0 w-full h-full pointer-events-none"
                           viewBox="0 0 1000 1000"
                           preserveAspectRatio="none"
                         >
                           {/* Technical Grid Overlay */}
                           <defs>
                             <pattern id="technicalGrid" width="40" height="40" patternUnits="userSpaceOnUse">
                               <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="0.5" strokeOpacity="0.05" />
                             </pattern>
                           </defs>
                           <rect width="1000" height="1000" fill="url(#technicalGrid)" />

                           {analysis.boxes.map((box) => {
                             const x1 = Number(box.x1) || 0;
                             const y1 = Number(box.y1) || 0;
                             const x2 = Number(box.x2) || 0;
                             const y2 = Number(box.y2) || 0;
                             const width = Math.max(0, x2 - x1);
                             const height = Math.max(0, y2 - y1);
                             
                             return (
                               <g key={box.id}>
                                 {/* Deep Wireframe Rect */}
                                 <rect
                                   x={x1}
                                   y={y1}
                                   width={width}
                                   height={height}
                                   fill="rgba(255,255,255,0.03)"
                                   stroke="white"
                                   strokeWidth="1.5"
                                   strokeDasharray="4 2"
                                   className="opacity-80"
                                 />
                                 
                                 {/* Dimension Labels */}
                                 <text
                                   x={x1 + 2}
                                   y={y1 - 4}
                                   fontSize="7"
                                   fill="white"
                                   opacity="0.4"
                                   fontFamily="monospace"
                                 >
                                   {Math.round(width)}x{Math.round(height)}
                                 </text>
  
                                 {/* Label Badge */}
                                 <rect
                                   x={x1}
                                   y={y1}
                                   width={(box.label?.length || 0) * 6 + 10}
                                   height="14"
                                   fill="white"
                                 />
                                 <text
                                   x={x1 + 5}
                                   y={y1 + 10}
                                   fontSize="9"
                                   fill="black"
                                   fontWeight="900"
                                   fontFamily="monospace"
                                 >
                                   {(box.label || '').toUpperCase()}
                                 </text>
                               </g>
                             );
                           })}
                   
                           {manualPoints.map((p, i) => (
                             <g key={i}>
                               <circle
                                 cx={p.x}
                                 cy={p.y}
                                 r="12"
                                 fill="none"
                                 stroke="white"
                                 strokeWidth="1"
                                 className="animate-ping"
                               />
                               <line x1={p.x - 20} y1={p.y} x2={p.x + 20} y2={p.y} stroke="white" strokeWidth="1" />
                               <line x1={p.x} y1={p.y - 20} x2={p.x} y2={p.y + 20} stroke="white" strokeWidth="1" />
                               <text x={p.x + 10} y={p.y - 10} fill="white" fontSize="8" fontFamily="monospace">PT_{i+1}</text>
                             </g>
                           ))}

                           {/* Active Scan Line */}
                           {analysis.isAnalyzing && (
                             <g className="scanning-line">
                               <line x1="0" y1="0" x2="1000" y2="0" stroke="white" strokeWidth="4" className="blur-[2px]" />
                               <line x1="0" y1="0" x2="1000" y2="0" stroke="white" strokeWidth="1" />
                               <rect x="0" y="-100" width="1000" height="100" fill="url(#scanGradient)" />
                               <defs>
                                 <linearGradient id="scanGradient" x1="0" x2="0" y1="0" y2="1">
                                    <stop offset="0%" stopColor="white" stopOpacity="0" />
                                    <stop offset="100%" stopColor="white" stopOpacity="0.1" />
                                 </linearGradient>
                               </defs>
                             </g>
                           )}
                         </svg>
                       )}
                      </motion.div>
                    ) : (
                      <motion.div
                        key="code"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="w-full h-full bg-[#050505] relative group/code"
                      >
                         <div className="absolute top-4 right-4 z-50">
                           <button 
                            onClick={copyCode}
                            className="bg-white text-black px-4 py-2 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 hover:bg-green-500 transition-colors shadow-2xl"
                           >
                             {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                             {copied ? 'COPIED_T_O_BUFFER' : 'COPY_ALL_CODE'}
                           </button>
                         </div>
                         <div className="p-8 font-mono text-xs overflow-auto h-full text-white/80 leading-relaxed border border-white/10">
                           <pre className="whitespace-pre-wrap">{analysis.generatedCode}</pre>
                         </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {analysis.isAnalyzing && (
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center text-white z-40">
                      <motion.div 
                        animate={{ rotate: 180 }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                        className="w-16 h-16 border-2 border-white/20 border-t-white rounded-full"
                      />
                      <p className="mt-6 text-[10px] font-bold tracking-[0.4em] uppercase opacity-60">Scanning Spatial Logic...</p>
                    </div>
                  )}

                  {analysis.isGenerating && (
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center text-white z-40">
                      <div className="flex gap-2 mb-6">
                        {[0, 1, 2].map(i => (
                          <motion.div 
                            key={i}
                            animate={{ height: [4, 16, 4], opacity: [0.3, 1, 0.3] }}
                            transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                            className="w-1 bg-white"
                          />
                        ))}
                      </div>
                      <p className="text-[10px] font-bold tracking-[0.4em] uppercase opacity-60">Compiling Component Replica...</p>
                    </div>
                  )}
                </div>

                <div className="absolute bottom-6 left-6 bg-black border border-white/20 p-4 max-w-[240px] z-30 shadow-2xl">
                  <p className="text-[10px] font-bold mb-2 uppercase tracking-widest text-[#22C55E]">[POINT_MODE_ACTIVE]</p>
                  <p className="text-[9px] opacity-50 leading-relaxed uppercase">
                    Tap any visual region to define extraction focus. Manual points overrule system defaults.
                  </p>
                </div>
              </div>
            </section>

            {/* Inspector Panel (Right) */}
            <aside className="w-full lg:w-[400px] border-t lg:border-t-0 lg:border-l border-white/20 bg-black flex flex-col">
              <div className="p-6 border-b border-white/20 bg-[#0a0a0a]">
                <h2 className="text-[10px] font-bold tracking-[0.3em] uppercase opacity-80">Structure_Analysis</h2>
              </div>
              
              <div className="flex-1 overflow-auto p-6 space-y-8">
                {/* focus point list if any */}
                {manualPoints.length > 0 && (
                  <div>
                    <p className="text-[9px] opacity-40 mb-4 uppercase tracking-[0.2em]">Active Focus Points</p>
                    <div className="flex flex-wrap gap-2">
                      {manualPoints.map((p, idx) => (
                        <div key={idx} className="flex items-center gap-2 bg-white/5 border border-white/20 pl-2 pr-1 py-1">
                          <span className="text-[8px] font-bold text-white/60">PT_{idx+1}</span>
                          <button 
                            onClick={() => removePoint(idx)}
                            className="p-1 hover:text-red-500 transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Statistics Box */}
                <div className="grid grid-cols-2 gap-[1px] bg-white/20 border border-white/20 overflow-hidden">
                  <div className="p-4 bg-black">
                    <p className="text-[8px] opacity-40 uppercase tracking-widest mb-1">Elements</p>
                    <p className="text-xl font-bold font-mono tracking-tighter">{analysis.boxes.length || '--'}</p>
                  </div>
                  <div className="p-4 bg-black">
                    <p className="text-[8px] opacity-40 uppercase tracking-widest mb-1">Focus Pts</p>
                    <p className="text-xl font-bold font-mono tracking-tighter text-[#22C55E]">{manualPoints.length}</p>
                  </div>
                </div>

                {/* Element List */}
                {analysis.boxes.length > 0 && (
                  <div>
                    <p className="text-[9px] opacity-40 mb-4 uppercase tracking-[0.2em]">Detected Node Buffer</p>
                    <div className="space-y-[1px] bg-white/10 border border-white/10">
                      {analysis.boxes.slice(0, 10).map((box, idx) => (
                        <div key={box.id} className="p-3 bg-black flex items-center justify-between group hover:bg-white/5 transition-colors">
                          <span className="text-[10px] font-mono opacity-60">{(idx + 1).toString().padStart(2, '0')}. {box.label}</span>
                          <span className="text-[8px] border border-white/20 px-1 font-mono uppercase opacity-40 group-hover:opacity-100 group-hover:border-white transition-all">
                            COMP.{Math.floor(Math.random() * 20 + 80)}%
                          </span>
                        </div>
                      ))}
                      {analysis.boxes.length > 10 && (
                        <div className="p-2 bg-black text-center">
                          <span className="text-[8px] opacity-30 uppercase tracking-[0.2em]">+{analysis.boxes.length - 10} Additional Nodes</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Computed Tokens Mock (Theme integration) */}
                <div>
                   <p className="text-[9px] opacity-40 mb-4 uppercase tracking-[0.2em]">Heuristic Tokens</p>
                   <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 border border-white/10 bg-white/[0.02]">
                        <p className="text-[8px] opacity-30 uppercase mb-1">Primary Color</p>
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 bg-white" />
                          <p className="text-[10px] font-bold">#FFFFFF</p>
                        </div>
                      </div>
                      <div className="p-3 border border-white/10 bg-white/[0.02]">
                        <p className="text-[8px] opacity-30 uppercase mb-1">Radius</p>
                        <p className="text-[10px] font-bold">0px</p>
                      </div>
                   </div>
                </div>

                {/* System Messages */}
                {analysis.error && (
                  <div className="p-4 border border-red-500/50 bg-red-500/10 text-red-400">
                    <p className="text-[10px] font-bold uppercase tracking-widest mb-2 flex items-center gap-2">
                      <Trash2 className="w-3 h-3" /> System_Failure
                    </p>
                    <p className="text-[9px] leading-relaxed uppercase">{analysis.error}</p>
                  </div>
                )}
              </div>

              {/* Action Area */}
              <div className="p-6 border-t border-white/20 bg-[#050505]">
                <div className="space-y-4">
                  <button 
                    onClick={analyzeImage}
                    disabled={!image || analysis.isAnalyzing}
                    className="w-full h-16 bg-white text-black font-black uppercase tracking-[0.3em] text-[12px] hover:invert transition-all disabled:opacity-20 flex items-center justify-center gap-2"
                  >
                    <RefreshCw className={`w-4 h-4 ${analysis.isAnalyzing ? 'animate-spin' : ''}`} />
                    START_SYSTEM_SCAN
                  </button>

                  <button 
                    onClick={generateCode}
                    disabled={!image || analysis.isGenerating || analysis.isAnalyzing}
                    className="w-full h-20 bg-white text-black font-black uppercase tracking-[0.3em] text-xs hover:bg-[#E0E0E0] transition-all disabled:opacity-20 flex flex-col items-center justify-center gap-1 group"
                  >
                    <div className="flex items-center gap-2 group-hover:translate-y-[-2px] transition-transform">
                      GENERATE_REPLICA
                      <Code className="w-4 h-4" />
                    </div>
                    <span className="text-[8px] opacity-60 font-mono tracking-normal">ISO STANDALONE ASSET</span>
                  </button>
                </div>
              </div>
            </aside>
          </>
        )}
      </div>

      {/* Footer Info Rail */}
      <footer className="h-10 border-t border-white/20 px-8 flex items-center justify-between text-[8px] bg-[#050505] opacity-50 uppercase tracking-[0.2em] font-mono">
        <div className="flex gap-8">
          <span className="flex items-center gap-2">
            <Maximize2 className="w-2.5 h-2.5" />
            V_BUFF: 1024x1024_NORM
          </span>
          <span className="hidden sm:inline">ENGINE: GEMINI_3_FLASH_P</span>
          <span className="hidden sm:inline">ENC: UTF-8</span>
        </div>
        <div className="flex items-center gap-4">
          {analysis.generatedCode && (
            <button 
              onClick={copyCode}
              className="hover:text-white transition-colors flex items-center gap-1 border border-white/20 px-2 py-0.5"
            >
              {copied ? 'COPIED_OK' : 'COPY_BUFFER_CLIP'}
            </button>
          )}
          <span>SYS_STATUS // ACTIVE</span>
        </div>
      </footer>

      {analysis.error && (
        <div className="fixed bottom-6 right-6 bg-red-500 text-white p-4 font-bold uppercase tracking-widest text-xs shadow-2xl flex items-center gap-3 animate-bounce z-50">
          <Trash2 className="w-4 h-4" />
          {analysis.error}
          <button onClick={() => setAnalysis(prev => ({ ...prev, error: null }))} className="ml-4 opacity-70">✕</button>
        </div>
      )}
    </div>
  );
}
