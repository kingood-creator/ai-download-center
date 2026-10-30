// 图片预览渲染进程：从 query 读取 target/url，受控展示，失败显示错误
(function () {
const params = new URLSearchParams(location.search);
const target = params.get('target') || '';
const isUrl = params.get('url') === '1';

const img = document.getElementById('img') as HTMLImageElement;
const err = document.getElementById('err') as HTMLElement;
const bar = document.getElementById('bar') as HTMLElement;

if (!target) {
  err.style.display = 'block';
  img.style.display = 'none';
} else {
  const src = isUrl ? target : 'file://' + target;
  img.src = src;
  img.onload = () => {
    img.style.display = 'block';
    err.style.display = 'none';
    bar.textContent = isUrl ? '远程图片（受控视图）' : '本地图片';
  };
  img.onerror = () => {
    img.style.display = 'none';
    err.style.display = 'block';
  };
}
})();

