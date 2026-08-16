var count = 0;
document.getElementById('btn').addEventListener('click', function () {
  count += 1;
  document.getElementById('count').textContent = String(count);
});
