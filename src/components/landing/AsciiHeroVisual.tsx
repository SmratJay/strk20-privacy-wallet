'use client';

import React, { useState, useEffect } from 'react';

const ASCII_FRAMES = [
`              .%#####%%*+=-.                  
          .*%@@@@@@@@@@@@@@@@%#=.             
       .=%@@@@@@@@@@@@@@@@@@@@@@@%+:          
     -#@@@@@@@@@@@@@@@@@@@@@@@@@@@@@#=.       
   =%@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@%+.     
 .#@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@#:    
 =@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@%:   
+@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@#   
#@@@@@@@@@@@@@@@@@#+-...-+#@@@@@@@@@@@@@@@@=  
%@@@@@@@@@@@@@@%=.          .=%@@@@@@@@@@@@+  
@@@@@@@@@@@@@@+                =@@@@@@@@@@@#  
@@@@@@@@@@@@@:                  +@@@@@@@@@@%  
@@@@@@@@@@@@#                    %@@@@@@@@@%  
%@@@@@@@@@@@#                    %@@@@@@@@@%  
#@@@@@@@@@@@%                    %@@@@@@@@@#  
+@@@@@@@@@@@@-                  =@@@@@@@@@@=  
 =@@@@@@@@@@@@*.               *@@@@@@@@@@%:  
 .#@@@@@@@@@@@@%+:          .=%@@@@@@@@@@#:   
   =%@@@@@@@@@@@@@%*+====+*#@@@@@@@@@@@%+.    
     -#@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@#=.      
       .=%@@@@@@@@@@@@@@@@@@@@@@@@%+:         
          .*%@@@@@@@@@@@@@@@@%#=.             
              .%#####%%*+=-.                  `,

`              .#%%%%%%*+=-.                   
          .+#@@@@@@@@@@@@@@@@%*=.             
       .=%@@@@@@@@@@@@@@@@@@@@@@@#+:          
     -#@@@@@@@@@@@@@@@@@@@@@@@@@@@@@%-.       
   +%@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@%+.     
 .#@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@#:    
 =@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@%:   
+@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@#   
#@@@@@@@@@@@@@@@@@#+-...-+#@@@@@@@@@@@@@@@@=  
%@@@@@@@@@@@@@@%=.          .=%@@@@@@@@@@@@+  
@@@@@@@@@@@@@@+                =@@@@@@@@@@@#  
@@@@@@@@@@@@@:                  +@@@@@@@@@@%  
@@@@@@@@@@@@#    [ ORRANGE ]     %@@@@@@@@@%  
%@@@@@@@@@@@#    ZK PRIVACY      %@@@@@@@@@%  
#@@@@@@@@@@@%    STARKNET L2     %@@@@@@@@@#  
+@@@@@@@@@@@@-                  =@@@@@@@@@@=  
 =@@@@@@@@@@@@*.               *@@@@@@@@@@%:  
 .#@@@@@@@@@@@@%+:          .=%@@@@@@@@@@#:   
   =%@@@@@@@@@@@@@%*+====+*#@@@@@@@@@@@%+.    
     -#@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@#=.      
       .=%@@@@@@@@@@@@@@@@@@@@@@@@%+:         
          .*%@@@@@@@@@@@@@@@@%#=.             
              .#%%%%%%*+=-.                   `
];

export const AsciiHeroVisual: React.FC = () => {
  const [frameIndex, setFrameIndex] = useState(0);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const interval = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % ASCII_FRAMES.length);
    }, 2400);
    return () => clearInterval(interval);
  }, []);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMousePos({
      x: ((e.clientX - rect.left) / rect.width - 0.5) * 15,
      y: ((e.clientY - rect.top) / rect.height - 0.5) * 15,
    });
  };

  return (
    <div 
      onMouseMove={handleMouseMove}
      className="relative flex items-center justify-center p-6 select-none overflow-hidden group cursor-crosshair"
    >
      {/* Background Ambient Orange Aura */}
      <div 
        className="absolute w-80 h-80 rounded-full bg-orrange-500/10 blur-3xl pointer-events-none transition-transform duration-700 ease-out"
        style={{
          transform: `translate(${mousePos.x * 2}px, ${mousePos.y * 2}px)`,
        }}
      />

      {/* ASCII Character Container */}
      <div 
        className="relative z-10 transition-transform duration-500 ease-out"
        style={{
          transform: `perspective(800px) rotateY(${mousePos.x}deg) rotateX(${-mousePos.y}deg)`,
        }}
      >
        <pre className="font-mono text-[9px] sm:text-[11px] md:text-[12px] leading-[11px] sm:leading-[13px] md:leading-[14px] text-orrange-500 font-bold tracking-widest text-center terminal-glow opacity-95 transition-all duration-300 group-hover:text-orrange-400 group-hover:opacity-100">
          {ASCII_FRAMES[frameIndex]}
        </pre>
      </div>

      {/* Decorative Matrix Frame Corner Ticks */}
      <div className="absolute top-2 left-2 text-[10px] font-mono text-zinc-700 flex items-center gap-1">
        <span className="text-orrange-500">●</span>
        <span>MATRIX_ENGINE // v0.2.Stwo</span>
      </div>
      <div className="absolute bottom-2 right-2 text-[10px] font-mono text-zinc-700">
        [ POSEIDON // STARK_CURVE ]
      </div>
    </div>
  );
};
