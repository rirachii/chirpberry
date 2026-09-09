import {createIcons, ArrowUpRight, ArrowDown, ArrowDownRight, Mic, NotebookPen, Pin, Folder, HardDrive, Sparkles, Languages, CalendarDays, AudioLines, ListChecks, PencilLine, Search, FolderInput, Monitor} from 'lucide';
createIcons({icons:{ArrowUpRight,ArrowDown,ArrowDownRight,Mic,NotebookPen,Pin,Folder,HardDrive,Sparkles,Languages,CalendarDays,AudioLines,ListChecks,PencilLine,Search,FolderInput,Monitor}});

export const installCommand='brew install --cask rirachii/tap/chirpberry';
document.querySelectorAll('.brew-copy').forEach(container=>{
  const button=container.querySelector('.copy');
  const status=container.querySelector('.copy-status');
  let timeout;
  button.addEventListener('click',async()=>{
    clearTimeout(timeout);
    try {
      await navigator.clipboard.writeText(installCommand);
      button.textContent='Copied';status.textContent='';
      timeout=setTimeout(()=>{button.textContent='Copy'},2000);
    } catch {button.textContent='Copy';status.textContent='Select the command and copy it manually.'}
  });
});

const examples={vi:['Mình sẽ gửi bản cập nhật vào thứ Sáu.',"I'll send the update on Friday."],zh:['我会在星期五发送更新。',"I'll send the update on Friday."],id:['Saya akan mengirim pembaruan pada hari Jumat.',"I'll send the update on Friday."]};
document.querySelectorAll('[data-language]').forEach(button=>{
  button.addEventListener('click',()=>{
    const language=button.dataset.language;
    document.querySelectorAll('[data-language]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
    const original=document.querySelector('.example-original');original.textContent=examples[language][0];original.lang=language;
    document.querySelector('.example-translation').textContent=examples[language][1];
  });
});
document.querySelectorAll('a[href="#install"]').forEach(link=>link.addEventListener('click',()=>{document.querySelector('#install').open=true}));
