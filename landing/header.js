const headerMenus=[...document.querySelectorAll('.header-menu')];
headerMenus.forEach(menu=>menu.addEventListener('toggle',()=>{if(menu.open)headerMenus.forEach(other=>{if(other!==menu)other.open=false})}));
document.addEventListener('click',event=>headerMenus.forEach(menu=>{if(!menu.contains(event.target))menu.open=false}));
document.addEventListener('keydown',event=>{if(event.key==='Escape'){const open=headerMenus.find(menu=>menu.open);if(open){open.open=false;open.querySelector('summary').focus()}}});
