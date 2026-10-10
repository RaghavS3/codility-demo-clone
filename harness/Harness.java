import java.io.*;
import java.lang.reflect.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/**
 * Runs Solution.solution(...) on test cases case<i>.json in a directory.
 * Usage: java Harness <dir> <start> <count>
 *
 * Protocol on the real stdout (user output is captured separately):
 *   \u0001START i
 *   \u0001RESULT {"i":..,"ms":..,"out":"..","ret":"<json>"}   or  ..,"error":".."
 *   \u0001FATAL message
 *   \u0001DONE
 */
public class Harness {
    static final int OUT_CAP = 8192;
    static PrintStream proto;

    static final class CappedStream extends OutputStream {
        final ByteArrayOutputStream buf = new ByteArrayOutputStream();
        boolean truncated;

        @Override public void write(int b) {
            if (buf.size() < OUT_CAP) buf.write(b); else truncated = true;
        }

        @Override public void write(byte[] b, int off, int len) {
            int room = OUT_CAP - buf.size();
            if (len > room) { truncated = true; len = Math.max(0, room); }
            buf.write(b, off, len);
        }

        String text() {
            return buf.toString(StandardCharsets.UTF_8) + (truncated ? "\n...(output truncated)" : "");
        }
    }

    public static void main(String[] args) throws Exception {
        Path dir = Paths.get(args[0]);
        int start = Integer.parseInt(args[1]);
        int count = Integer.parseInt(args[2]);
        proto = new PrintStream(new FileOutputStream(FileDescriptor.out), true, "UTF-8");
        PrintStream sink = new PrintStream(OutputStream.nullOutputStream());

        Class<?> cls;
        try {
            cls = Class.forName("Solution");
        } catch (Throwable e) {
            fatal("class Solution not found. Your code must define a class named Solution.");
            return;
        }
        int arity = ((List<?>) ((Map<?, ?>) Json.parse(Files.readString(dir.resolve("meta.json")))).get("params")).size();
        Method m = null;
        for (Method cand : cls.getDeclaredMethods()) {
            if (cand.getName().equals("solution") && cand.getParameterCount() == arity) { m = cand; break; }
        }
        if (m == null) {
            fatal("method solution with " + arity + " parameter(s) not found in class Solution.");
            return;
        }
        m.setAccessible(true);
        Constructor<?> ctor = null;
        if (!Modifier.isStatic(m.getModifiers())) {
            try {
                ctor = cls.getDeclaredConstructor();
                ctor.setAccessible(true);
            } catch (NoSuchMethodException e) {
                fatal("class Solution needs a no-argument constructor.");
                return;
            }
        }
        Class<?>[] ptypes = m.getParameterTypes();

        for (int i = start; i < count; i++) {
            Map<?, ?> c = (Map<?, ?>) Json.parse(Files.readString(dir.resolve("case" + i + ".json")));
            List<?> argv = (List<?>) c.get("args");
            Object[] callArgs = new Object[arity];
            String convErr = null;
            for (int j = 0; j < arity; j++) {
                try {
                    callArgs[j] = convert(argv.get(j), ptypes[j]);
                } catch (RuntimeException e) {
                    convErr = "cannot pass argument " + (j + 1) + " as " + ptypes[j].getSimpleName() + ": " + e.getMessage();
                }
            }
            CappedStream cap = new CappedStream();
            PrintStream ps = new PrintStream(cap, true, StandardCharsets.UTF_8);
            Object result = null;
            Throwable err = null;
            long t0 = 0, t1 = 0;
            proto.print("\u0001START " + i + "\n");
            proto.flush();
            if (convErr == null) {
                System.setOut(ps);
                System.setErr(ps);
                try {
                    Object inst = ctor == null ? null : ctor.newInstance();
                    t0 = System.nanoTime();
                    result = m.invoke(inst, callArgs);
                    t1 = System.nanoTime();
                } catch (InvocationTargetException e) {
                    t1 = System.nanoTime();
                    err = e.getCause();
                } catch (Throwable e) {
                    t1 = System.nanoTime();
                    err = e;
                }
                ps.flush();
                System.setOut(sink);
                System.setErr(sink);
            }
            StringBuilder sb = new StringBuilder();
            sb.append("{\"i\":").append(i).append(",\"ms\":").append((t1 - t0) / 1e6);
            sb.append(",\"out\":").append(Json.quote(cap.text()));
            if (convErr != null) sb.append(",\"error\":").append(Json.quote(convErr));
            else if (err != null) sb.append(",\"error\":").append(Json.quote(describe(err)));
            else sb.append(",\"ret\":").append(Json.quote(Json.write(result)));
            sb.append("}");
            proto.print("\u0001RESULT " + sb + "\n");
            proto.flush();
        }
        proto.print("\u0001DONE\n");
        proto.flush();
        System.exit(0);
    }

    static void fatal(String msg) {
        proto.print("\u0001FATAL " + msg.replace('\n', ' ') + "\n");
        proto.flush();
        System.exit(0);
    }

    static String describe(Throwable e) {
        StringBuilder sb = new StringBuilder("Exception in thread \"main\" ").append(e.toString());
        int shown = 0;
        for (StackTraceElement f : e.getStackTrace()) {
            String cn = f.getClassName();
            if (cn.startsWith("java.") || cn.startsWith("jdk.") || cn.startsWith("sun.") || cn.equals("Harness")) continue;
            if (shown == 12) { sb.append("\n\t..."); break; }
            sb.append("\n\tat ").append(f.toString().replace("Solution.java", "solution.java"));
            shown++;
        }
        return sb.toString();
    }

    static Object convert(Object v, Class<?> t) {
        if (t == int.class || t == Integer.class) return toLong(v).intValue();
        if (t == long.class || t == Long.class) return toLong(v);
        if (t == double.class || t == Double.class) return ((Number) v).doubleValue();
        if (t == boolean.class || t == Boolean.class) return (Boolean) v;
        if (t == String.class) return (String) v;
        if (t == char[].class) return ((String) v).toCharArray();
        if (t.isArray()) {
            List<?> list = (List<?>) v;
            Class<?> ct = t.getComponentType();
            if (ct == int.class) {
                int[] a = new int[list.size()];
                for (int k = 0; k < a.length; k++) a[k] = toLong(list.get(k)).intValue();
                return a;
            }
            if (ct == long.class) {
                long[] a = new long[list.size()];
                for (int k = 0; k < a.length; k++) a[k] = toLong(list.get(k));
                return a;
            }
            Object a = Array.newInstance(ct, list.size());
            for (int k = 0; k < list.size(); k++) Array.set(a, k, convert(list.get(k), ct));
            return a;
        }
        if (List.class.isAssignableFrom(t)) return new ArrayList<>((List<?>) v);
        throw new IllegalArgumentException("unsupported parameter type " + t.getName());
    }

    static Long toLong(Object v) {
        if (v instanceof Long) return (Long) v;
        if (v instanceof Number) return ((Number) v).longValue();
        throw new IllegalArgumentException("expected a number, got " + v);
    }

    /** Minimal JSON reader/writer: enough for test data. */
    static final class Json {
        final String s;
        int p;

        Json(String s) { this.s = s; }

        static Object parse(String s) {
            Json j = new Json(s);
            j.ws();
            Object v = j.value();
            return v;
        }

        void ws() {
            while (p < s.length() && Character.isWhitespace(s.charAt(p))) p++;
        }

        Object value() {
            char c = s.charAt(p);
            if (c == '[') {
                p++;
                ArrayList<Object> list = new ArrayList<>();
                ws();
                if (s.charAt(p) == ']') { p++; return list; }
                while (true) {
                    ws();
                    list.add(value());
                    ws();
                    char d = s.charAt(p++);
                    if (d == ']') return list;
                }
            }
            if (c == '{') {
                p++;
                LinkedHashMap<String, Object> map = new LinkedHashMap<>();
                ws();
                if (s.charAt(p) == '}') { p++; return map; }
                while (true) {
                    ws();
                    String k = string();
                    ws();
                    p++; // ':'
                    ws();
                    map.put(k, value());
                    ws();
                    char d = s.charAt(p++);
                    if (d == '}') return map;
                }
            }
            if (c == '"') return string();
            if (s.startsWith("true", p)) { p += 4; return Boolean.TRUE; }
            if (s.startsWith("false", p)) { p += 5; return Boolean.FALSE; }
            if (s.startsWith("null", p)) { p += 4; return null; }
            int st = p;
            boolean frac = false;
            while (p < s.length() && "+-0123456789.eE".indexOf(s.charAt(p)) >= 0) {
                char d = s.charAt(p);
                if (d == '.' || d == 'e' || d == 'E') frac = true;
                p++;
            }
            String num = s.substring(st, p);
            if (!frac) return Long.parseLong(num);
            double dv = Double.parseDouble(num);
            if (dv == Math.rint(dv) && Math.abs(dv) < 9e18) return (long) dv;
            return dv;
        }

        String string() {
            p++; // opening quote
            StringBuilder sb = new StringBuilder();
            while (true) {
                char c = s.charAt(p++);
                if (c == '"') return sb.toString();
                if (c != '\\') { sb.append(c); continue; }
                char e = s.charAt(p++);
                switch (e) {
                    case 'n': sb.append('\n'); break;
                    case 't': sb.append('\t'); break;
                    case 'r': sb.append('\r'); break;
                    case 'b': sb.append('\b'); break;
                    case 'f': sb.append('\f'); break;
                    case 'u': sb.append((char) Integer.parseInt(s.substring(p, p + 4), 16)); p += 4; break;
                    default: sb.append(e);
                }
            }
        }

        static String quote(String v) {
            StringBuilder sb = new StringBuilder("\"");
            for (int i = 0; i < v.length(); i++) {
                char c = v.charAt(i);
                switch (c) {
                    case '"': sb.append("\\\""); break;
                    case '\\': sb.append("\\\\"); break;
                    case '\n': sb.append("\\n"); break;
                    case '\r': sb.append("\\r"); break;
                    case '\t': sb.append("\\t"); break;
                    default:
                        if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                        else sb.append(c);
                }
            }
            return sb.append('"').toString();
        }

        static String write(Object v) {
            if (v == null) return "null";
            if (v instanceof String) return quote((String) v);
            if (v instanceof Character) return quote(String.valueOf(v));
            if (v instanceof Boolean) return v.toString();
            if (v instanceof Double || v instanceof Float) {
                double d = ((Number) v).doubleValue();
                if (Double.isNaN(d) || Double.isInfinite(d)) return quote(String.valueOf(d));
                if (d == Math.rint(d) && Math.abs(d) < 9e15) return String.valueOf((long) d);
                return String.valueOf(d);
            }
            if (v instanceof Number) return v.toString();
            if (v.getClass().isArray()) {
                if (v instanceof char[]) return quote(new String((char[]) v));
                StringBuilder sb = new StringBuilder("[");
                int n = Array.getLength(v);
                for (int i = 0; i < n; i++) {
                    if (i > 0) sb.append(',');
                    sb.append(write(Array.get(v, i)));
                }
                return sb.append(']').toString();
            }
            if (v instanceof Collection) {
                StringBuilder sb = new StringBuilder("[");
                boolean first = true;
                for (Object o : (Collection<?>) v) {
                    if (!first) sb.append(',');
                    sb.append(write(o));
                    first = false;
                }
                return sb.append(']').toString();
            }
            return quote(v.toString());
        }
    }
}
