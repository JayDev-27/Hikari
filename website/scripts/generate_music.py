import math
import struct
import wave
import os
import subprocess

SAMPLE_RATE = 44100
BPM = 60.0
BEAT = 60.0 / BPM          # 1.0 s
BAR = BEAT * 4.0           # 4.0 s
TOTAL_BARS = 8
DURATION = BAR * TOTAL_BARS  # 32.0 s
TOTAL_SAMPLES = int(SAMPLE_RATE * DURATION)

left = [0.0] * TOTAL_SAMPLES
right = [0.0] * TOTAL_SAMPLES

def note_freq(name):
    notes = {'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'F': 5,
             'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11}
    octave = int(name[-1])
    n = name[:-1]
    midi = 12 + octave * 12 + notes[n]
    return 440.0 * (2.0 ** ((midi - 69) / 12.0))

CHORDS = [
    # Bar 1-2: Dmaj9
    {'start': 0.0, 'end': 8.0, 'bass': note_freq('D2'),
     'pad': [note_freq('D3'), note_freq('F#3'), note_freq('A3'), note_freq('C#4'), note_freq('E4')]},
    # Bar 3-4: Gmaj7
    {'start': 8.0, 'end': 16.0, 'bass': note_freq('G1'),
     'pad': [note_freq('G3'), note_freq('B3'), note_freq('D4'), note_freq('F#4'), note_freq('A4')]},
    # Bar 5-6: Bm9
    {'start': 16.0, 'end': 24.0, 'bass': note_freq('B1'),
     'pad': [note_freq('B2'), note_freq('D3'), note_freq('F#3'), note_freq('A3'), note_freq('C#4')]},
    # Bar 7-8: Asus4 -> A7
    {'start': 24.0, 'end': 32.0, 'bass': note_freq('A1'),
     'pad': [note_freq('A2'), note_freq('E3'), note_freq('G3'), note_freq('C#4'), note_freq('E4')]},
]

print("Rendering Layer 1: Ambient Glass Pads & Sub Bass...")
for chord in CHORDS:
    start_s = chord['start']
    end_s = chord['end']
    chord_len = end_s - start_s
    start_idx = int(start_s * SAMPLE_RATE)
    chord_samples = int(chord_len * SAMPLE_RATE)
    
    for v_idx, f in enumerate(chord['pad']):
        detune = 0.45 * (1 if v_idx % 2 == 0 else -1)
        pan_l = 0.5 + 0.35 * math.sin(v_idx * 1.5)
        pan_r = 1.0 - pan_l
        
        for i in range(chord_samples):
            idx = (start_idx + i) % TOTAL_SAMPLES
            t = i / SAMPLE_RATE
            
            fade = 1.2
            if t < fade:
                env = 0.5 * (1.0 - math.cos(math.pi * t / fade))
            elif t > chord_len - fade:
                env = 0.5 * (1.0 + math.cos(math.pi * (t - (chord_len - fade)) / fade))
            else:
                env = 1.0
                
            phase1 = 2.0 * math.pi * (f + detune) * t
            phase2 = 2.0 * math.pi * (f - detune) * t
            phase_oct = 2.0 * math.pi * (f * 2.0) * t
            
            lfo = 0.7 + 0.3 * math.sin(2.0 * math.pi * 0.15 * t + v_idx)
            sig = (math.sin(phase1) * 0.45 + math.sin(phase2) * 0.45 + math.sin(phase_oct) * 0.1) * env * lfo
            
            left[idx] += sig * pan_l * 0.055
            right[idx] += sig * pan_r * 0.055

    bf = chord['bass']
    for i in range(chord_samples):
        idx = (start_idx + i) % TOTAL_SAMPLES
        t = i / SAMPLE_RATE
        fade = 0.8
        if t < fade:
            env = 0.5 * (1.0 - math.cos(math.pi * t / fade))
        elif t > chord_len - fade:
            env = 0.5 * (1.0 + math.cos(math.pi * (t - (chord_len - fade)) / fade))
        else:
            env = 1.0
            
        phase = 2.0 * math.pi * bf * t
        sub = (math.sin(phase) + 0.15 * math.sin(phase * 2.0)) * env * 0.075
        left[idx] += sub * 0.5
        right[idx] += sub * 0.5

print("Rendering Layer 2: Crystal Sakura Bells (Celesta Chimes)...")
MELODY = [
    (0.5, 'D5', 0.85, 0.4),
    (1.75, 'F#5', 0.9, 0.6),
    (2.75, 'A5', 0.95, 0.45),
    (3.5, 'C#6', 0.8, 0.7),
    (4.5, 'B5', 0.9, 0.35),
    (5.75, 'A5', 0.85, 0.55),
    (6.5, 'F#5', 0.75, 0.45),
    (7.25, 'E5', 0.7, 0.6),
    (8.5, 'D5', 0.85, 0.4),
    (9.75, 'G5', 0.9, 0.65),
    (10.75, 'B5', 0.95, 0.35),
    (11.5, 'D6', 0.85, 0.6),
    (12.5, 'C#6', 0.9, 0.4),
    (13.75, 'B5', 0.85, 0.6),
    (14.75, 'A5', 0.8, 0.5),
    (15.5, 'F#5', 0.7, 0.4),
    (16.5, 'F#5', 0.9, 0.6),
    (17.75, 'A5', 0.9, 0.35),
    (18.75, 'C#6', 0.95, 0.65),
    (19.5, 'E6', 0.85, 0.5),
    (20.5, 'D6', 0.95, 0.4),
    (21.75, 'C#6', 0.85, 0.6),
    (22.75, 'B5', 0.8, 0.35),
    (23.5, 'A5', 0.75, 0.55),
    (24.5, 'G5', 0.85, 0.4),
    (25.75, 'A5', 0.9, 0.6),
    (26.75, 'B5', 0.85, 0.45),
    (27.5, 'C#6', 0.8, 0.65),
    (28.5, 'D6', 0.95, 0.5),
    (29.75, 'A5', 0.85, 0.4),
    (30.75, 'F#5', 0.75, 0.6),
    (31.5, 'E5', 0.65, 0.5),
]

for note_time, n_name, vel, pan in MELODY:
    f = note_freq(n_name)
    note_start_idx = int(note_time * SAMPLE_RATE)
    bell_duration = 3.5
    bell_samples = int(bell_duration * SAMPLE_RATE)
    
    pan_l = pan
    pan_r = 1.0 - pan
    
    for i in range(bell_samples):
        idx = (note_start_idx + i) % TOTAL_SAMPLES
        t = i / SAMPLE_RATE
        
        decay = math.exp(-t * 1.6)
        strike_decay = math.exp(-t * 6.5)
        
        osc1 = math.sin(2.0 * math.pi * f * t) * decay
        osc2 = math.sin(2.0 * math.pi * f * 2.76 * t) * strike_decay * 0.35
        osc3 = math.sin(2.0 * math.pi * f * 5.40 * t) * strike_decay * 0.15
        osc4 = math.sin(2.0 * math.pi * f * 0.5 * t) * decay * 0.25
        
        bell_sig = (osc1 + osc2 + osc3 + osc4) * vel * 0.065
        
        left[idx] += bell_sig * pan_l
        right[idx] += bell_sig * pan_r
        
        d_left = int(0.375 * SAMPLE_RATE)
        d_right = int(0.500 * SAMPLE_RATE)
        left[(idx + d_left) % TOTAL_SAMPLES] += bell_sig * 0.35 * pan_r
        right[(idx + d_right) % TOTAL_SAMPLES] += bell_sig * 0.35 * pan_l
        left[(idx + d_left * 2) % TOTAL_SAMPLES] += bell_sig * 0.15 * pan_l
        right[(idx + d_right * 2) % TOTAL_SAMPLES] += bell_sig * 0.15 * pan_r

print("Rendering Layer 3: Warm Analog Tape Air & Shimmer Atmosphere...")
import random
random.seed(42)
pink_b0, pink_b1, pink_b2 = 0.0, 0.0, 0.0
for i in range(TOTAL_SAMPLES):
    t = i / SAMPLE_RATE
    white = (random.random() * 2.0 - 1.0)
    pink_b0 = 0.99886 * pink_b0 + white * 0.0555179
    pink_b1 = 0.99332 * pink_b1 + white * 0.0750759
    pink_b2 = 0.96900 * pink_b2 + white * 0.1538520
    pink = (pink_b0 + pink_b1 + pink_b2 + white * 0.5362) * 0.003
    
    swell = 0.5 + 0.5 * math.sin(2.0 * math.pi * t / 8.0)
    shimmer = (math.sin(2.0 * math.pi * 1174.66 * t) * 0.6 +
               math.sin(2.0 * math.pi * 1760.00 * t) * 0.4) * swell * 0.0045
               
    left[i] += pink + shimmer * 0.45
    right[i] += pink + shimmer * 0.55

print("Mastering: Soft Saturation and Peak Normalization...")
max_peak = 0.0
for i in range(TOTAL_SAMPLES):
    max_peak = max(max_peak, abs(left[i]), abs(right[i]))

print(f"Pre-master peak: {max_peak:.3f}")
target_peak = 0.88
gain = target_peak / max(max_peak, 0.0001)

for i in range(TOTAL_SAMPLES):
    l = left[i] * gain
    r = right[i] * gain
    left[i] = math.tanh(l)
    right[i] = math.tanh(r)

wav_path = "website/public/media/hikari-ambient.wav"
mp3_path = "website/public/media/hikari-ambient.mp3"

os.makedirs("website/public/media", exist_ok=True)

print(f"Writing 16-bit 44.1kHz stereo WAV to {wav_path}...")
with wave.open(wav_path, 'wb') as wf:
    wf.setnchannels(2)
    wf.setsampwidth(2)
    wf.setframerate(SAMPLE_RATE)
    
    buf = bytearray(TOTAL_SAMPLES * 4)
    for i in range(TOTAL_SAMPLES):
        li = int(max(-32767, min(32767, left[i] * 32767)))
        ri = int(max(-32767, min(32767, right[i] * 32767)))
        struct.pack_into('<hh', buf, i * 4, li, ri)
    wf.writeframes(buf)

print(f"Converting to high-quality 320kbps MP3 via ffmpeg: {mp3_path}...")
subprocess.run([
    "/Users/jatin/.local/bin/ffmpeg", "-y",
    "-i", wav_path,
    "-codec:a", "libmp3lame",
    "-b:a", "320k",
    mp3_path
], check=True)

os.remove(wav_path)
print(f"Done! Created pristine seamless ambient music: {mp3_path} ({os.path.getsize(mp3_path)} bytes)")
