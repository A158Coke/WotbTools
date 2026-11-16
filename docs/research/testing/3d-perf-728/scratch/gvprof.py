import json,sys,re,collections
f=sys.argv[1]; p=json.load(open(f))
cats=[c['name'] for c in p['meta']['categories']]
best=None
for q in p['processes']:
    for t in q['threads']:
        if t['name']=='GeckoMain' and t['processType']=='tab':
            n=len(t['stackTable']['data'])
            if best is None or n>best[0]: best=(n,t)
n,t=best; print('content GeckoMain samples',n)
S=t['samples']['schema']; ST=t['stackTable']['schema']; FT=t['frameTable']['schema']
st=t['stackTable']['data']; fr=t['frameTable']['data']; strs=t['stringTable']
def loc(i): return strs[fr[i][FT['location']]]
def stack_frames(s):
    out=[]
    while s is not None:
        row=st[s]; out.append(row[ST['frame']]); s=row[ST['prefix']]
    return out  # leaf first
samples=t['samples']['data']
times=[r[S['time']] for r in samples]
if len(times)>1:
    d=[b-a for a,b in zip(times,times[1:])]; d.sort(); print('sample dt p50 %.2f p95 %.2f max %.1f'%(d[len(d)//2],d[int(len(d)*.95)],d[-1]), 'span s %.1f'%((times[-1]-times[0])/1000))
def group(locs):
    # classify by deepest-known frame in stack (leaf first)
    j=' | '.join(locs)
    return j
def cls(frames):
    L=[loc(i) for i in frames]  # leaf first
    for l in L:
        if re.search(r'labelsRuntime|updateLabels|labelOverlay|LabelLayer|\.vue',l) and 'node_modules' not in l: pass
    def has(rx): return any(re.search(rx,l) for l in L)
    if has(r'^(Gecko|Layout|Reflow|Styles?|Restyle)|^(Layout)'): pass
    return L
selfcat=collections.Counter(); selffn=collections.Counter(); incl=collections.Counter(); total=0
rows=[]
for r in samples:
    s=r[S['stack']]
    if s is None: continue
    fs=stack_frames(s); total+=1
    leaf=fs[0]; c=None
    for i in fs:
        row=fr[i]
        if len(row)>FT['category'] and row[FT['category']] is not None: c=row[FT['category']]; break
    selfcat[cats[c] if c is not None else '?']+=1
    selffn[loc(leaf)]+=1
    for l in set(loc(i) for i in fs): incl[l]+=1
print('total stacked samples',total)
print('SELF by category:'); [print('  %-14s %5d %5.1f%%'%(k,v,100*v/total)) for k,v in selfcat.most_common()]
print('TOP self fn:'); [print('  %5d %5.1f%% %s'%(v,100*v/total,k[:140])) for k,v in selffn.most_common(25)]
print('TOP inclusive:'); [print('  %5d %5.1f%% %s'%(v,100*v/total,k[:140])) for k,v in incl.most_common(45)]
