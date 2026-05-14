import React, { useState } from 'react';
import { 
  Image as ImageIcon, FileText, Mic, Video, LayoutTemplate, 
  Youtube, Instagram, Facebook, Film, Music, File, 
  Layers, Scissors, Minimize, FolderOpen, 
  Maximize, Crop, Eraser, Droplet, ImageMinus, Wand2, 
  VolumeX, AudioWaveform, MonitorPlay, 
  PlaySquare, QrCode, ScanBarcode, Key, Palette, PenTool, 
  Code, Braces, Database, Binary, Link, Hash, 
  AlignLeft, Calculator, Type, Smile, Globe, Scale, 
  DollarSign, Timer, Tags, Search, LayoutGrid, FileJson,
  Volume2, RotateCw, FastForward, History, Captions, Clapperboard, SplitSquareHorizontal, ArrowUpRight, MousePointer2
} from 'lucide-react';
import { motion } from 'motion/react';

const TOOLS = [
  { name: 'Video Trimmer', icon: Scissors, category: 'Video' },
  { name: 'Video Merger', icon: Film, category: 'Video' },
  { name: 'Add Audio to Video', icon: Volume2, category: 'Video' },
  { name: 'Mute Video', icon: VolumeX, category: 'Video' },
  { name: 'Video to GIF', icon: PlaySquare, category: 'Video' },
  { name: 'GIF to Video', icon: Film, category: 'Video' },
  { name: 'Video Compressor', icon: Minimize, category: 'Video' },
  { name: 'Video Resizer', icon: Maximize, category: 'Video' },
  { name: 'Video Cropper', icon: Crop, category: 'Video' },
  { name: 'Video Rotator', icon: RotateCw, category: 'Video' },
  { name: 'Video Speed Control', icon: FastForward, category: 'Video' },
  { name: 'Reverse Video', icon: History, category: 'Video' },
  { name: 'Add Subtitles', icon: Captions, category: 'Video' },
  { name: 'Extract Subtitles', icon: Type, category: 'Video' },
  { name: 'Extract Audio', icon: AudioWaveform, category: 'Audio' },
  { name: 'Thumbnail Maker', icon: ImageIcon, category: 'Design' },
  { name: 'Remove Background', icon: Eraser, category: 'Design' },
  { name: 'Remove Video BG', icon: Video, category: 'Video' },
  { name: 'Image Converter', icon: ImageIcon, category: 'Design' },
  { name: 'SVG Editor', icon: PenTool, category: 'Design' },
  { name: 'YouTube Downloader', icon: Youtube, category: 'Social' },
  { name: 'Insta Downloader', icon: Instagram, category: 'Social' },
  { name: 'TikTok Downloader', icon: Video, category: 'Social' },
  { name: 'FB Downloader', icon: Facebook, category: 'Social' },
  { name: 'Video Converter', icon: Clapperboard, category: 'Video' },
  { name: 'Audio Converter', icon: Music, category: 'Audio' },
  { name: 'Audio Trimmer', icon: Scissors, category: 'Audio' },
  { name: 'Audio Enhancer', icon: Wand2, category: 'Audio' },
  { name: 'Noise Reduction', icon: AudioWaveform, category: 'Audio' },
  { name: 'Screen Recorder', icon: MonitorPlay, category: 'Video' },
  { name: 'Voice Recorder', icon: Mic, category: 'Audio' },
  { name: 'Banner Maker', icon: LayoutTemplate, category: 'Design' },
  { name: 'Meme Generator', icon: Smile, category: 'Design' },
  { name: 'Color Palette', icon: Palette, category: 'Design' },
  { name: 'Color Picker', icon: MousePointer2, category: 'Design' },
  { name: 'Aspect Ratio Calc', icon: SplitSquareHorizontal, category: 'Video' },
  { name: 'Add Watermark', icon: Droplet, category: 'Video' },
  { name: 'Remove Watermark', icon: Eraser, category: 'Video' },
  { name: 'Chroma Key (Green)', icon: Layers, category: 'Video' },
  { name: 'Blur Faces', icon: ImageMinus, category: 'Video' },
  { name: 'Image Upscaler', icon: Maximize, category: 'Design' },
  { name: 'Image Compressor', icon: Minimize, category: 'Design' },
  { name: 'Video Upscaler', icon: ArrowUpRight, category: 'Video' },
  { name: 'Teleprompter', icon: AlignLeft, category: 'Content' },
  { name: 'AI Script Gen', icon: Wand2, category: 'Content' },
  { name: 'Title Generator', icon: Type, category: 'Content' },
  { name: 'Tag Extractor', icon: Tags, category: 'Social' },
  { name: 'Caption Formatter', icon: AlignLeft, category: 'Social' },
  { name: 'Font Generator', icon: Type, category: 'Design' },
  { name: 'Text to Speech', icon: Mic, category: 'Audio' },
  { name: 'Speech to Text', icon: FileText, category: 'Audio' },
  { name: 'Icon Maker', icon: LayoutGrid, category: 'Design' },
  { name: 'Brand Kit Maker', icon: Palette, category: 'Design' }
];

export function ExploreTools() {
  const [search, setSearch] = useState('');

  const filtered = TOOLS.filter(t => t.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div id="explore-tools" className="w-full max-w-6xl mx-auto mt-24 px-4 pb-24">
      <div className="flex flex-col md:flex-row justify-between items-end mb-8 border-b border-zinc-200 dark:border-zinc-800 pb-4 gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white uppercase flex items-center gap-2">
            <LayoutGrid size={24} className="text-zinc-400" />
            Explore More Tools
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-2 font-mono">50+ powerful utilities for content creators, designers & video editors</p>
        </div>
        <div className="relative w-full md:w-64">
           <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
           <input 
             type="text" 
             placeholder="Search tools..." 
             className="w-full bg-white dark:bg-black border border-zinc-300 dark:border-zinc-700 text-sm pl-9 pr-4 py-2 text-zinc-900 dark:text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500 rounded-lg"
             value={search}
             onChange={e => setSearch(e.target.value)}
           />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {filtered.map((tool, idx) => {
          const Icon = tool.icon;
          return (
            <motion.a
              key={tool.name}
              href="#"
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: Math.min((idx % 12) * 0.05, 0.5) }}
              className="flex flex-col items-center justify-center py-6 px-2 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl hover:border-black dark:hover:border-white transition-all group text-center gap-3 cursor-pointer shadow-sm hover:shadow-md"
            >
              <div className="w-12 h-12 rounded-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 flex items-center justify-center text-zinc-500 dark:text-zinc-400 group-hover:text-black dark:group-hover:text-white group-hover:bg-zinc-100 dark:group-hover:bg-zinc-800 transition-colors">
                <Icon size={20} className="group-hover:scale-110 transition-transform" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-zinc-900 dark:text-white">{tool.name}</h3>
                <span className="text-[9px] uppercase tracking-widest text-zinc-400 dark:text-zinc-500 font-mono mt-1.5 block">{tool.category}</span>
              </div>
            </motion.a>
          );
        })}
      </div>
      
      {filtered.length === 0 && (
        <div className="text-center py-12 text-zinc-500 dark:text-zinc-400 font-mono text-sm border border-zinc-200 dark:border-zinc-800 rounded-xl border-dashed">
          No tools found matching "{search}"
        </div>
      )}
    </div>
  );
}
