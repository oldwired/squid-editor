"""Independent read-only decoder for SQUID format-4 project test data."""
import hashlib

PAGE = 0x1000
TRACK_STRIDE = 0xE8
PORTS = ("None", "MIDI 1", "MIDI 2", "USB", "CV/GATE 1", "CV/GATE 2")


def be16(data, offset):
    return int.from_bytes(data[offset:offset + 2], "big")


def cstr(data):
    return data.split(b"\0", 1)[0].decode("ascii", errors="replace")


def wire_to_native_step(word):
    """Inverse of PatternDataManager::serializePattern's packed step word."""
    return (((word >> 31) & 1) | (((word >> 30) & 1) << 1)
            | (((word >> 28) & 3) << 2) | (((word >> 26) & 3) << 4)
            | (((word >> 23) & 7) << 6) | (((word >> 22) & 1) << 9)
            | (((word >> 14) & 0xFF) << 10) | (((word >> 9) & 31) << 18))


def native_to_wire_step(word):
    return (((word & 1) << 31) | (((word >> 1) & 1) << 30)
            | (((word >> 2) & 3) << 28) | (((word >> 4) & 3) << 26)
            | (((word >> 6) & 7) << 23) | (((word >> 9) & 1) << 22)
            | (((word >> 10) & 0xFF) << 14) | (((word >> 18) & 31) << 9))


def parse_pattern(page, address, details=False):
    if len(page) != PAGE or page[:4] not in (b"seq2", b"seq3"):
        raise ValueError(f"unsupported/truncated pattern at {address:#x}")
    pages = page[4] & 0xF
    if not 1 <= pages <= 4:
        raise ValueError(f"invalid page count at {address:#x}: {pages}")
    steps = []
    for step in range(64):
        offset = 8 + step * 4
        word = int.from_bytes(page[offset:offset + 4], "big")
        native = wire_to_native_step(word)
        if native_to_wire_step(native) != word:
            raise ValueError(f"noncanonical packed step {step} at {address:#x}")
        note_mask = (native >> 10) & 0xFF
        notes = []
        for slot in range(8):
            n = 0x290 + step * 32 + slot * 4
            pitch, velocity, gate = page[n], page[n + 1], be16(page, n + 2)
            if note_mask & (1 << slot) and (pitch > 127 or velocity > 127 or gate > 511):
                raise ValueError(f"invalid enabled note at {address:#x}, step {step}, slot {slot}")
            if details or note_mask & (1 << slot):
                notes.append(dict(slot=slot, enabled=bool(note_mask & (1 << slot)),
                                  pitch=pitch, velocity=velocity, gate_raw=gate))
        if details or word & 0x80000000:
            a = 0xBD0 + step * 9
            steps.append(dict(step=step, enabled=bool(native & 1), tie=bool(native & 2), wire_word=f"0x{word:08x}",
                              count=((native >> 2) & 3) + 1,
                              divide=((native >> 4) & 3) + 1,
                              harmonizer_code=(native >> 6) & 7,
                              slide=bool(native & (1 << 9)), note_mask=note_mask,
                              note_offset_masks=list(page[0x110 + step * 6:0x116 + step * 6]),
                              notes=notes, cc_mask=(native >> 18) & 31,
                              cc_values=list(page[0xA90 + step * 5:0xA95 + step * 5]),
                              automation=dict(transpose=page[a], speed_control=page[a + 1],
                                              roll=page[a + 2], groove_bend=list(page[a + 3:a + 9]))))
    return dict(file_offset=f"0x{address:06x}", version=page[:4].decode(),
                nominal_pages=pages, nominal_steps=pages * 16,
                enabled_steps=sum(bool(int.from_bytes(page[8 + s * 4:12 + s * 4], "big") & 0x80000000)
                                  for s in range(64)),
                pattern_speed_code=page[5] if page[:4] == b"seq3" else None,
                direction_code=int.from_bytes(page[0xE28:0xE2C], "big"),
                enabled_page_bitmaps=[f"0x{be16(page, 0x108 + i * 2):04x}" for i in range(4)],
                speed_mod=list(page[0xE10:0xE13]), swing=page[0xE13],
                scale_type=page[0xE20], scale_key=page[0xE21],
                probability_rate=page[0xE22], probability_enabled=page[0xE23],
                fixed_length_enabled=page[0xE24], fixed_length_steps=page[0xE25],
                steps=steps)


def parse_project_container(blob, base_offset=0, details=False):
    if len(blob) < PAGE or len(blob) % PAGE:
        raise ValueError("project must contain complete 4 KiB header/pattern pages")
    project = blob[:PAGE]
    if project[:4] != bytes.fromhex("83490004"):
        raise ValueError("expected project format 4 (83490004)")
    tracks, patterns, page_index = [], [], 1
    for track in range(16):
        base = 0x2C + track * TRACK_STRIDE
        settings = 0xB4 + track * TRACK_STRIDE
        active_slots = [slot for slot in range(64)
                        if project[base + slot // 8] & (0x80 >> (slot & 7))]
        signature = cstr(project[settings:settings + 8])
        prefix = f"trk{track + 1:02d}"
        if signature not in (prefix, prefix + "V3"):
            raise ValueError(f"unexpected track signature: {signature}")
        name = cstr(project[settings + 0x14:settings + 0x34])
        routing = None
        if signature.endswith("V3"):
            port = project[settings + 8] >> 3
            channel = (((project[settings + 8] & 7) << 1) | (project[settings + 9] >> 7)) + 1
            routing = dict(port_code=port, port=PORTS[port] if port < len(PORTS) else "Unknown",
                           midi_channel=channel)
        tracks.append(dict(track=track + 1, name=name, signature=signature,
                           settings_file_offset=f"0x{base_offset + settings:06x}",
                           track_setting_version=1 if signature == prefix else int(signature[-1]),
                           routing_v3=routing,
                           controls_v3=dict(delay_ms=project[settings + 0x10],
                                            bank_msb=project[settings + 0x11],
                                            bank_lsb=project[settings + 0x12],
                                            program=project[settings + 0x13]) if signature.endswith("V3") else None,
                           pattern_slots=[s + 1 for s in active_slots],
                           stored_sector_ids={str(s + 1): be16(project, base + 8 + s * 2)
                                              for s in active_slots}))
        for slot in active_slots:
            offset = page_index * PAGE
            address = base_offset + offset
            p = parse_pattern(blob[offset:offset + PAGE], address, details)
            p.update(track=track + 1, track_name=name, pattern_slot=slot + 1)
            patterns.append(p)
            page_index += 1
    if page_index * PAGE != len(blob):
        raise ValueError("project occupancy bitmap/page count disagree")
    return dict(project_name=cstr(project[4:0x25]),
                project_version=be16(project, 2), bpm_x10=be16(project, 0xFB0),
                track_count=len(tracks), pattern_count=len(patterns),
                tracks=tracks, patterns=patterns)


def inspect_project(blob, details=False):
    return dict(sha256=hashlib.sha256(blob).hexdigest(), file_size=len(blob),
                **parse_project_container(blob, details=details))
