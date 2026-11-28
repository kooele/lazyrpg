# Fit the win curve and a power factor per enemy type to type-only balance runs (see rebalance.sim.ts).
#   python3 tools/balance/fitfac.py <report> [...]   -> tools/balance/out/fit.json
import json, math, sys
thr={k:v.get('threat',1) for k,v in json.load(open(__file__.rsplit('/tools/',1)[0]+'/src/data/enemies.json'))['enemies'].items()}
def load(n):
    d=json.load(open(__file__.rsplit('/',1)[0]+f'/out/{n}.json')); return d
sig=lambda z:1/(1+math.exp(-z))
def fit(pts):
    a,b=0.0,1.0
    for _ in range(100):
        ga=gb=haa=hab=hbb=0
        for x,y,f in pts:
            p=sig(a+b*(x+f)); w=p*(1-p)+1e-9
            ga+=y-p; gb+=(y-p)*(x+f); haa+=w; hab+=w*(x+f); hbb+=w*(x+f)**2
        det=haa*hbb-hab*hab; da=(hbb*ga-hab*gb)/det; db=(haa*gb-hab*ga)/det; a+=da; b+=db
        if abs(da)+abs(db)<1e-10: break
    return a,b
names=sys.argv[1:]
cells=[]
for n in names:
    d=load(n)
    for s,runs in zip(d['summary'],d['runs']):
        foes=s['quest'].get('foes')
        t=foes[0] if foes and len(foes)==1 else None
        if t and s['quest']['count']>=12*thr[t]-1e-6: continue
        cells.append((t,math.log(s['ratio']),[r.get('score', 1 if r['win'] else 0) for r in runs],s['quest']['stage']))
# joint fit: global a,b plus per-type offset (log power ratio shift); alternate
types=sorted({c[0] for c in cells if c[0]})
off={t:0.0 for t in types}
for it in range(30):
    a,b=fit([(x,y,off.get(t,0) if t else 0) for t,x,ys,_ in cells for y in ys])
    for t in types:
        cs=[(x,ys) for tt,x,ys,_ in cells if tt==t]
        lo,hi=-6,6
        n=sum(len(ys) for _,ys in cs); won=sum(sum(ys) for _,ys in cs); won=min(n-0.5,max(0.5,won))
        for _ in range(60):
            m=(lo+hi)/2; p=sum(sig(a+b*(x+m))*len(ys) for x,ys in cs)
            if p>won: hi=m
            else: lo=m
        off[t]=(lo+hi)/2
    # The curve's a and the offsets' mean trade off: keep the offsets' (battle-weighted) mean at 0, so a carries it.
    tot=sum(len(ys) for t,x,ys,_ in cells if t); mean=sum(off[t]*len(ys) for t,x,ys,_ in cells if t)/tot
    for t in types: off[t]-=mean
logit=lambda p: math.log(p/(1-p))
print(f'a {a:.3f} b {b:.3f} r33 {math.exp((logit(0.33)-a)/b):.3f} r50 {math.exp(-a/b):.3f}')
for t in types:
    n=sum(len(ys) for tt,x,ys,_ in cells if tt==t); won=sum(sum(ys) for tt,x,ys,_ in cells if tt==t)
    # offset m added to ln(ratio) => enemy power factor = exp(-m/2) on enemy value
    print(f'{t:10} n {n:4} win {won/n:.2f}  enemy power factor {math.exp(-off[t]/2):.3f}')

# Battle length: the rounds after the walk in (APPROACH) scale about 1 / k when Health is divided by k and attack
# multiplied by k (same value). k per type and level, aiming at TARGET_ROUNDS on average.
APPROACH = 3
# Target rounds: about 10 up to enemy level 8, rising to 11 by level 20 (late fights may run 8-16 rounds); Trolls are
# the grindy enemy, at 14.
def target_rounds(t, stage):
    if t == 'troll': return 14
    return 10 + 1 * max(0, min(1, (stage - 8) / 12))
tempo={}
for n in names:
    d=load(n)
    for s_,runs in zip(d['summary'],d['runs']):
        foes=s_['quest'].get('foes')
        if not foes or len(foes)!=1: continue
        st=str(s_['quest']['stage'])
        tempo.setdefault(foes[0],{}).setdefault(st,[]).extend(r['rounds'] for r in runs)
tempoK={t:{st:max(0.5,min(2.5,(sum(v)/len(v)-APPROACH)/(target_rounds(t,int(st))-APPROACH))) for st,v in sv.items()} for t,sv in tempo.items()}
for t,sv in tempoK.items(): print(f'{t:10} tempo k', ' '.join(f'St{st} {k:.2f}' for st,k in sv.items()))
# Per level: how far each (type, enemy level) is from its type's factor, with the curve fixed.
resid={}
for t in types:
    for st in sorted({c[3] for c in cells if c[0]==t}):
        cs=[(x,ys) for tt,x,ys,stg in cells if tt==t and stg==st]
        n=sum(len(ys) for _,ys in cs); won=sum(sum(ys) for _,ys in cs); won=min(n-0.5,max(0.5,won))
        lo,hi=-6,6
        for _ in range(60):
            m=(lo+hi)/2; p=sum(sig(a+b*(x+m))*len(ys) for x,ys in cs)
            if p>won: hi=m
            else: lo=m
        resid.setdefault(t,{})[str(st)]=math.exp(-((lo+hi)/2-off[t])/2)
    print(f'{t:10} by level', ' '.join(f'St{k} x{v:.2f}' for k,v in resid[t].items()))
out={'tempo':tempoK,'levelFactors':resid,'par':math.exp((logit(0.33)-a)/b),'a':a,'b':b,'factors':{t:math.exp(-off[t]/2) for t in types}}
json.dump(out,open(__file__.rsplit('/',1)[0]+'/out/fit.json','w'),indent=1)
