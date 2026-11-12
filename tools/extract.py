"""Gera site/coracao.glb (+ coracao.json) a partir do atlas BodyParts3D do repositório human-atlas.

Uso:
    git -c gc.auto=0 clone --depth 1 --filter=blob:none --no-checkout https://github.com/ashemag/human-atlas.git ha
    cd ha && git -c gc.auto=0 checkout HEAD -- public/models/atlas.json 'public/models/*.bin' public/ATTRIBUTION.md && cd ..
    pip install numpy pygltflib
    python tools/extract.py ha/public/models site/coracao.glb

Modelo: BodyParts3D, (c) The Database Center for Life Science, CC BY 4.0.
"""
import json, re, sys
import numpy as np
import pygltflib as G

SRC, OUT = sys.argv[1], sys.argv[2]
atlas = json.load(open(f"{SRC}/atlas.json"))
chunks = {}

def load(p):
    c = p['chunk']
    if c not in chunks:
        chunks[c] = open(f"{SRC}/body-{c}.bin", 'rb').read()
    b = chunks[c]
    pos = np.frombuffer(b, np.float32, p['vertexCount']*3, p['positions']).reshape(-1, 3)
    nrm = np.frombuffer(b, np.int16, p['vertexCount']*3, p['normals']).reshape(-1, 3).astype(np.float32) / 32767
    idx = np.frombuffer(b, np.uint32, p['indexCount'], p['indices'])
    return pos, nrm, idx

# O system "cardiac" do atlas inclui por engano os ventrículos cerebrais: filtramos por NOME.
GROUPS = {
  'atrio_direito':      r'^Wall of right atrium$',
  'atrio_esquerdo':     r'^Wall of left atrium$',
  'ventriculos':        r'^Wall of ventricle$',
  'cav_atrio_dir':      r'^Cavity of right atrium$',
  'cav_vent_dir':       r'^Cavity of right ventricle$',
  'cav_atrio_esq':      r'^Cavity of left atrium$',
  'cav_vent_esq':       r'^Cavity of left ventricle$',
  'valva_tricuspide':   r'leaflet of tricuspid valve$',
  'valva_pulmonar':     r'cusp of pulmonary valve$',
  'valva_mitral':       r'leaflet of mitral valve$',
  'valva_aortica':      r'cusp of aortic valve$',
  'veia_cava_superior': r'^Superior vena cava$',
  'veia_cava_inferior': r'^Inferior vena cava$',
  'tronco_pulmonar':    r'^Pulmonary trunk$',
  'arterias_pulmonares':r'^(Left|Right) pulmonary artery$',
  'veias_pulmonares':   r'^(Left|Right) (superior|inferior) pulmonary vein$',
  'aorta_ascendente':   r'^Ascending aorta$',
  'arco_aorta':         r'^Arch of aorta$',
  'aorta_descendente':  r'^Descending thoracic aorta$',
  'coronaria_direita':  r'right coronary artery$',
  'coronaria_esquerda': r'left coronary artery$',
  'seio_coronario':     r'^Coronary sinus$',
  'traqueia_bronquios': r'^Trachea$|bronch',
  'caixa_toracica':     r'^(Left|Right) \w+ rib$|costal cartilage$|^Manubrium$|^Body of sternum$|^Xiphoid process$|^\w+ thoracic vertebra$',
  'diafragma':          r'^Diaphragm$',
}
SYS_OK = {'traqueia_bronquios': {'respiratory'}}

groups = {k: [] for k in GROUPS}
for p in atlas['parts']:
    for g, rx in GROUPS.items():
        if re.search(rx, p['name']):
            if g in SYS_OK and p['system'] not in SYS_OK[g]:
                continue
            groups[g].append(p); break

heart = [p for g in ('atrio_direito', 'atrio_esquerdo', 'ventriculos') for p in groups[g]]
lo = np.min([p['bounds'][0] for p in heart], 0); hi = np.max([p['bounds'][1] for p in heart], 0)
center = (lo + hi) / 2   # origem do GLB = centro do coração

gltf = G.GLTF2(scene=0, scenes=[G.Scene(nodes=[])]); blob = bytearray()
def add_view(arr, target):
    global blob
    while len(blob) % 4: blob += b'\0'
    off = len(blob); data = arr.tobytes(); blob += data
    gltf.bufferViews.append(G.BufferView(buffer=0, byteOffset=off, byteLength=len(data), target=target))
    return len(gltf.bufferViews) - 1

info = {}
for g, parts in groups.items():
    if not parts: print('VAZIO', g); continue
    P, N, I, base = [], [], [], 0
    for p in parts:
        pos, nrm, idx = load(p)
        P.append(pos - center); N.append(nrm); I.append(idx + base); base += len(pos)
    P = np.concatenate(P).astype(np.float32); N = np.concatenate(N).astype(np.float32)
    nl = np.linalg.norm(N, axis=1, keepdims=True); nl[nl == 0] = 1; N = (N / nl).astype(np.float32)
    I = np.concatenate(I).astype(np.uint32)
    vp = add_view(P, G.ARRAY_BUFFER); vn = add_view(N, G.ARRAY_BUFFER); vi = add_view(I, G.ELEMENT_ARRAY_BUFFER)
    a0 = len(gltf.accessors)
    gltf.accessors += [
        G.Accessor(bufferView=vp, componentType=G.FLOAT, count=len(P), type=G.VEC3, min=P.min(0).tolist(), max=P.max(0).tolist()),
        G.Accessor(bufferView=vn, componentType=G.FLOAT, count=len(N), type=G.VEC3),
        G.Accessor(bufferView=vi, componentType=G.UNSIGNED_INT, count=len(I), type=G.SCALAR)]
    gltf.materials.append(G.Material(name=g, pbrMetallicRoughness=G.PbrMetallicRoughness(baseColorFactor=[1,1,1,1], metallicFactor=0, roughnessFactor=.6)))
    gltf.meshes.append(G.Mesh(name=g, primitives=[G.Primitive(attributes=G.Attributes(POSITION=a0, NORMAL=a0+1), indices=a0+2, material=len(gltf.materials)-1)]))
    gltf.nodes.append(G.Node(name=g, mesh=len(gltf.meshes)-1)); gltf.scenes[0].nodes.append(len(gltf.nodes)-1)
    info[g] = {'tris': int(len(I)//3), 'parts': len(parts), 'center': ((P.min(0)+P.max(0))/2).round(4).tolist()}

gltf.buffers.append(G.Buffer(byteLength=len(blob))); gltf.set_binary_blob(bytes(blob)); gltf.save_binary(OUT)
json.dump(info, open(OUT.replace('.glb', '.json'), 'w'), indent=1)
print('ok', OUT, len(info), 'grupos')
