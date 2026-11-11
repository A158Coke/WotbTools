import csv,statistics as st
a=list(csv.DictReader(open('../field-reports/2026-11-10-oneplus-ace-pro/帧率，SoC频率 2026-11-10 15-29-29.csv',encoding='utf-8-sig')))
b=list(csv.DictReader(open('../field-reports/2026-11-10-oneplus-ace-pro/线程负载 2026-11-10 15-35-42.csv',encoding='utf-8-sig')))
f=lambda r,k: float(r[k])
def m(rows,k): return st.mean(f(r,k) for r in rows)
print('n',len(a),len(b))
print('per-core util%',[round(m(a,f'CPU{i}(%)'),1) for i in range(8)])
print('per-core MHz mean',[round(m(a,f'CPU{i}(MHz)')) for i in range(8)])
for i in range(8):
    v=[f(r,f'CPU{i}(MHz)') for r in a]; mx=max(v); print(i,'max',mx,'min',min(v),'frac>=0.95max',round(sum(x>=.95*mx for x in v)/len(v),2))
print('GPU% mean/max',m(a,'GPU(%)'),max(f(r,'GPU(%)') for r in a)); 
from collections import Counter
print('GPU MHz',Counter(r['GPU(MHz)'] for r in a).most_common())
print('temp',m(a,'CPU(℃)'),'DDR',Counter(r['DDR(Mbps)'] for r in a).most_common(3))
print('power mW mean',m(a,'Power(mW)'),'cur',m(a,'Current(mA)'))
fp=[f(r,'FPS') for r in a]
for name,pred in [('fps>=70',lambda x:x>=70),('30-70',lambda x:30<=x<70),('10-30',lambda x:10<=x<30),('<10',lambda x:x<10)]:
    rows=[(r,s) for r,s in zip(a,fp) if pred(s)]
    rr=[r for r,_ in rows]
    if not rr: continue
    print(name,len(rr),'web%',round(st.mean(float(b[a.index(r)]['Isolated Web Co']) for r in rr),1),'GPU%',round(m(rr,'GPU(%)'),1),'GPUMHz',round(m(rr,'GPU(MHz)')),'cpu7%',round(m(rr,'CPU7(%)'),1),'cpu7MHz',round(m(rr,'CPU7(MHz)')),'cpu0-3%',round(st.mean(m(rr,f'CPU{i}(%)') for i in range(4)),1),'cpu4-6%',round(st.mean(m(rr,f'CPU{i}(%)') for i in (4,5,6)),1),'maxft',round(m(rr,'Max FrameTime(ms)')),'power',round(m(rr,'Power(mW)')))
# corr
def corr(x,y):
    mx,my=st.mean(x),st.mean(y); return sum((i-mx)*(j-my) for i,j in zip(x,y))/ (sum((i-mx)**2 for i in x)*sum((j-my)**2 for j in y))**.5
for k in ['GPU(%)','GPU(MHz)','CPU7(%)','CPU4(%)','CPU5(%)','CPU6(%)','CPU0(%)','CPU7(MHz)','CPU(℃)']:
    print('corr FPS vs',k,round(corr(fp,[f(r,k) for r in a]),2))
for k in ['Isolated Web Co','Renderer','CanvasRenderer','WRRenderBackend','Compositor','AndroidUI']:
    print('thr',k,round(st.mean(float(r[k]) for r in b),1),'max',max(float(r[k]) for r in b),'corrFPS',round(corr(fp,[float(r[k]) for r in b]),2))
print('web content cpus col',Counter(r['Isolated Web Co(cpus)'] for r in a).most_common(3), 'Renderer',Counter(r['Renderer(cpus)'] for r in a).most_common(2),'Canvas',Counter(r['CanvasRenderer(cpus)'] for r in a).most_common(2),'AndroidUI',Counter(r['AndroidUI(cpus)'] for r in a).most_common(2))
# web% vs sum of big core: does web% > any single mid/little core capacity? 
print('web>=90 secs',sum(float(r['Isolated Web Co'])>=90 for r in b),'>=70',sum(float(r['Isolated Web Co'])>=70 for r in b))
print('Mcycles total/sec mean per core',[round(m(a,f'CPU{i}(M Cycles)')) for i in range(8)])
print('GPU% buckets',Counter(int(f(r,'GPU(%)')//20)*20 for r in a))
print('jank',m(a,'JANK'),m(a,'BigJANK'))
