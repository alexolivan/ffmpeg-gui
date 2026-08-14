import sqlite3
import json
import os
import sys
import configparser

def get_candidate_db_paths():
    paths = []
    if len(sys.argv) > 1:
        paths.append(sys.argv[1])
    if os.environ.get("DATABASE_PATH"):
        paths.append(os.environ["DATABASE_PATH"])
        
    config_paths = [
        "/etc/ffmpeg-gui/ffmpeg-gui.conf",
        os.path.expanduser("~/.config/ffmpeg-gui/ffmpeg-gui.conf"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "ffmpeg-gui.conf")
    ]
    for cp in config_paths:
        if os.path.exists(cp):
            try:
                cfg = configparser.ConfigParser()
                cfg.read(cp)
                if "server" in cfg and "database" in cfg["server"]:
                    conf_db = os.path.abspath(cfg["server"]["database"])
                    if conf_db not in paths:
                        paths.append(conf_db)
            except Exception as e:
                print(f"Error leyendo {cp}: {e}")
                
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    default_db = os.path.join(base_dir, "ffmpeg_gui.db")
    if default_db not in paths:
        paths.append(default_db)
        
    extra_candidates = [
        "/etc/ffmpeg-gui/ffmpeg_gui.db",
        "/var/lib/ffmpeg-gui/ffmpeg_gui.db",
        os.path.expanduser("~/.config/ffmpeg-gui/ffmpeg_gui.db"),
    ]
    for ec in extra_candidates:
        if os.path.exists(ec) and ec not in paths:
            paths.append(ec)
            
    existing_paths = [p for p in paths if os.path.exists(p)]
    return existing_paths if existing_paths else [default_db]

def migrate_db_file(db_path):
    if not os.path.exists(db_path):
        print(f"Base de datos no encontrada en: {db_path}. Se omitirá.")
        return True
        
    print(f"Iniciando migración en: {db_path}")
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    try:
        # 1. Renombrar o copiar desde ffmpeg_builds si existe
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='ffmpeg_builds'")
        has_ffmpeg_builds = bool(cursor.fetchone())
        
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='software_builds'")
        has_software_builds = bool(cursor.fetchone())
        
        if has_ffmpeg_builds and not has_software_builds:
            print("Renombrando tabla ffmpeg_builds a software_builds...")
            cursor.execute("ALTER TABLE ffmpeg_builds RENAME TO software_builds")
            conn.commit()
        elif has_ffmpeg_builds and has_software_builds:
            print("Ambas tablas existen. Copiando datos de ffmpeg_builds a software_builds...")
            
            cursor.execute("PRAGMA table_info(software_builds)")
            target_cols = [row[1] for row in cursor.fetchall()]
            
            cursor.execute("PRAGMA table_info(ffmpeg_builds)")
            src_cols = [row[1] for row in cursor.fetchall()]
            
            cursor.execute("SELECT * FROM ffmpeg_builds")
            rows = cursor.fetchall()
            for row in rows:
                row_dict = dict(zip(src_cols, row))
                
                insert_data = {
                    "id": row_dict.get("id"),
                    "name": row_dict.get("name"),
                    "software_type": "ffmpeg",
                    "version_tag": row_dict.get("ffmpeg_version"),
                    "binary_path": row_dict.get("ffmpeg_binary"),
                    "version_output": row_dict.get("ffmpeg_version_output"),
                    "install_path": row_dict.get("install_path"),
                    "status": row_dict.get("status"),
                    "is_default": row_dict.get("is_default"),
                    "sources_cleaned": row_dict.get("sources_cleaned"),
                    "auto_clean": row_dict.get("auto_clean"),
                    "disk_usage_mb": row_dict.get("disk_usage_mb"),
                    "build_log_summary": row_dict.get("build_log_summary"),
                    "created_at": row_dict.get("created_at"),
                    "built_at": row_dict.get("built_at"),
                    "storage_id": row_dict.get("storage_id"),
                }
                
                try:
                    opts = json.loads(row_dict.get("build_options") or '{}')
                except Exception:
                    opts = {}
                if row_dict.get("srt_version"):
                    opts['srt_version'] = row_dict.get("srt_version")
                insert_data["build_options"] = json.dumps(opts)
                insert_data["sdk_paths"] = row_dict.get("sdk_paths")
                
                cursor.execute("SELECT id FROM software_builds WHERE id = ?", (insert_data["id"],))
                if not cursor.fetchone():
                    cols_str = ", ".join(insert_data.keys())
                    placeholders = ", ".join(["?"] * len(insert_data))
                    cursor.execute(
                        f"INSERT INTO software_builds ({cols_str}) VALUES ({placeholders})",
                        tuple(insert_data.values())
                    )
            
            cursor.execute("DROP TABLE ffmpeg_builds")
            conn.commit()
            print("Copia completada y tabla ffmpeg_builds eliminada.")
            
        # 2. Verificar columnas existentes en software_builds
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='software_builds'")
        if cursor.fetchone():
            cursor.execute("PRAGMA table_info(software_builds)")
            columns = [row[1] for row in cursor.fetchall()]
            
            if "software_type" not in columns:
                print("Añadiendo columna: software_type...")
                cursor.execute("ALTER TABLE software_builds ADD COLUMN software_type TEXT DEFAULT 'ffmpeg'")
            if "version_tag" not in columns:
                print("Añadiendo columna: version_tag...")
                cursor.execute("ALTER TABLE software_builds ADD COLUMN version_tag TEXT DEFAULT NULL")
            if "binary_path" not in columns:
                print("Añadiendo columna: binary_path...")
                cursor.execute("ALTER TABLE software_builds ADD COLUMN binary_path TEXT DEFAULT NULL")
            if "version_output" not in columns:
                print("Añadiendo columna: version_output...")
                cursor.execute("ALTER TABLE software_builds ADD COLUMN version_output TEXT DEFAULT NULL")
            conn.commit()
            
            cursor.execute("PRAGMA table_info(software_builds)")
            columns = [row[1] for row in cursor.fetchall()]
            
            cursor.execute("SELECT id, build_options FROM software_builds")
            builds = cursor.fetchall()
            
            has_ffmpeg_version = "ffmpeg_version" in columns
            has_ffmpeg_binary = "ffmpeg_binary" in columns
            has_ffmpeg_version_output = "ffmpeg_version_output" in columns
            has_srt_version = "srt_version" in columns
            
            for build_id, build_opts_str in builds:
                ff_ver, ff_bin, ff_ver_out, srt_ver = None, None, None, None
                if has_ffmpeg_version:
                    cursor.execute("SELECT ffmpeg_version FROM software_builds WHERE id = ?", (build_id,))
                    ff_ver = cursor.fetchone()[0]
                if has_ffmpeg_binary:
                    cursor.execute("SELECT ffmpeg_binary FROM software_builds WHERE id = ?", (build_id,))
                    ff_bin = cursor.fetchone()[0]
                if has_ffmpeg_version_output:
                    cursor.execute("SELECT ffmpeg_version_output FROM software_builds WHERE id = ?", (build_id,))
                    ff_ver_out = cursor.fetchone()[0]
                if has_srt_version:
                    cursor.execute("SELECT srt_version FROM software_builds WHERE id = ?", (build_id,))
                    srt_ver = cursor.fetchone()[0]
                    
                cursor.execute(
                    "UPDATE software_builds SET version_tag = COALESCE(version_tag, ?), binary_path = COALESCE(binary_path, ?), version_output = COALESCE(version_output, ?) WHERE id = ?",
                    (ff_ver, ff_bin, ff_ver_out, build_id)
                )
                
                if srt_ver:
                    try:
                        opts = json.loads(build_opts_str or '{}')
                    except Exception:
                        opts = {}
                    opts['srt_version'] = srt_ver
                    cursor.execute(
                        "UPDATE software_builds SET build_options = ? WHERE id = ?",
                        (json.dumps(opts), build_id)
                    )
                    
            conn.commit()

            for col_to_drop in ["ffmpeg_version", "ffmpeg_binary", "ffmpeg_version_output", "srt_version"]:
                if col_to_drop in columns:
                    try:
                        print(f"Eliminando columna obsoleta: {col_to_drop}...")
                        cursor.execute(f"ALTER TABLE software_builds DROP COLUMN {col_to_drop}")
                        conn.commit()
                    except Exception as drop_err:
                        print(f"Advertencia: No se pudo eliminar la columna {col_to_drop}: {drop_err}")

        print(f"Migración completada con éxito en {db_path}.")
        return True
    except Exception as e:
        print(f"ERROR durante la migración en {db_path}: {e}")
        conn.rollback()
        return False
    finally:
        conn.close()

def migrate():
    db_paths = get_candidate_db_paths()
    print(f"Bases de datos candidatas a migrar: {db_paths}")
    success_all = True
    for db_path in db_paths:
        res = migrate_db_file(db_path)
        if not res:
            success_all = False
    return success_all

if __name__ == "__main__":
    success = migrate()
    sys.exit(0 if success else 1)
